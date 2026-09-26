// Tests for the process Provisioner. Every effect is faked: children are
// EventEmitters, kill acts on an in-memory process-group table, ps and the
// group listing are scripted, the filesystem is a Map, and the clock moves
// only when the code sleeps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
// Through the package's own exports map, the way a consumer imports it.
import { createProcessProvisioner } from '@critical-labs/qa-conductor/adapters/provisioner-process'

const STATE_DIR = '/state'
const PIDFILE = '/state/pids.json'
const BASE = { role: 'base' }
const PR = { role: 'pr' }

function fakeChild(pid) {
  const child = new EventEmitter()
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

const errno = code => Object.assign(new Error(`kill ${code}`), { code })

// A process-group table: killFn(-pgid, sig) behaves like kill(2) on it.
function fakeGroups() {
  const alive = new Set()
  const survivesTerm = new Set()
  const survivesKill = new Set()
  const calls = []
  const hooks = { onSignal: null }
  function killFn(pid, sig) {
    calls.push([pid, sig])
    const pgid = -pid
    hooks.onSignal?.(pgid, sig)
    if (!alive.has(pgid)) throw errno('ESRCH')
    if (sig === 'SIGTERM' && !survivesTerm.has(pgid)) alive.delete(pgid)
    if (sig === 'SIGKILL' && !survivesKill.has(pgid)) alive.delete(pgid)
    return true
  }
  return { alive, survivesTerm, survivesKill, calls, hooks, killFn }
}

function memFs() {
  const files = new Map()
  const ops = []
  const dir = { symlink: false, directory: true, uid: process.getuid(), mode: 0o40700 }
  return {
    files,
    ops,
    dir,
    async mkdir(path, opts) { ops.push(['mkdir', path, opts]) },
    async lstat() {
      return { isSymbolicLink: () => dir.symlink, isDirectory: () => dir.directory, uid: dir.uid, mode: dir.mode }
    },
    async chmod(path, mode) { ops.push(['chmod', path, mode]) },
    async readFile(path) {
      if (!files.has(path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
      return files.get(path)
    },
    async writeFile(path, data, opts) {
      ops.push(['writeFile', path, opts])
      files.set(path, String(data))
    },
    async rename(from, to) {
      ops.push(['rename', from, to])
      files.set(to, files.get(from))
      files.delete(from)
    },
  }
}

function setup({ pids = [], deps: overrides = {} } = {}) {
  const groups = fakeGroups()
  const spawned = []
  const fsx = memFs()
  const exitHooks = []
  const warnings = []
  let nextPid = 1001
  let nextPort = 4000
  let now = 0
  const deps = {
    command: ({ name, port }) => ({ cmd: `/w/bin/${name}`, args: ['--port', String(port)], cwd: '/w', env: { PORT: String(port) } }),
    stateDir: STATE_DIR,
    spawnFn(cmd, args, opts) {
      const child = fakeChild(pids.length ? pids.shift() : nextPid++)
      if (Number.isSafeInteger(child.pid)) groups.alive.add(child.pid)
      spawned.push({ cmd, args, opts, child })
      return child
    },
    killFn: groups.killFn,
    freePortFn: async () => nextPort++,
    fetchFn: async () => ({ status: 200 }),
    fsx,
    psFn: async pid => ({ startedAt: `t${pid}` }),
    pgroupFn: async () => [],
    nowFn: () => now,
    // The clock moves when a sleep completes, one macrotask later, so anything
    // that has already settled wins a race against a sleep.
    sleepFn: ms => new Promise(resolve => setImmediate(() => { now += ms; resolve() })),
    onExitFn: fn => exitHooks.push(fn),
    baseEnv: { PATH: '/usr/bin:/bin', HOME: '/home/me', GITHUB_QA_TOKEN: 'ghs_secret', AWS_SECRET_ACCESS_KEY: 'aws' },
    log: { warn: (...args) => warnings.push(args.join(' ')) },
    ...overrides,
  }
  const p = createProcessProvisioner(deps)
  return { p, groups, spawned, fsx, exitHooks, warnings, now: () => now }
}

function fakeDb(overrides = {}) {
  return {
    command: ({ port }) => ({
      cmd: '/usr/bin/java',
      args: ['-jar', 'DynamoDBLocal.jar', '-port', String(port)],
      cwd: '/opt/ddb',
      env: { JAVA_OPTS: '-Xmx256m' },
    }),
    ready: async () => {},
    handle: ({ paneRef, port }) => ({ dsn: `http://127.0.0.1:${port}`, db: { role: paneRef.role, port } }),
    ...overrides,
  }
}

async function launch(p, paneRef, services = { app: '/w' }, env = {}, signal) {
  const reserved = await p.reserveServices({ paneRef, services })
  await p.launchServices({ paneRef, services, env, reserved, signal })
  return reserved
}

const readPids = fsx => JSON.parse(fsx.files.get(PIDFILE) ?? '[]')
const entry = (pid, startedAt) => ({ pid, startedAt, paneRole: 'base', kind: 'service', name: 'app', cmd: '/w/bin/app', args: [] })

// --- construction ------------------------------------------------------------

test('createProcessProvisioner requires command and stateDir, and has no runMigrate', () => {
  assert.throws(() => createProcessProvisioner({ stateDir: '/s' }), /command/)
  assert.throws(() => createProcessProvisioner({ command: () => ({}) }), /stateDir/)
  assert.throws(
    () => createProcessProvisioner({ command: () => ({}), stateDir: '/s', database: { command() {} } }),
    /database/,
  )
  const { p } = setup()
  assert.equal(p.runMigrate, undefined)
  for (const m of ['provisionDatabase', 'reserveServices', 'launchServices', 'waitHealthy', 'logs', 'sweep', 'teardown']) {
    assert.equal(typeof p[m], 'function', m)
  }
})

// --- launch: envs, spawning, pidfile ------------------------------------------

test('services get exactly PATH, the pane env and the command env, spawned detached', async () => {
  const seen = []
  const { p, spawned } = setup({
    deps: {
      command: args => {
        seen.push(args)
        return {
          cmd: '/w/node_modules/.bin/tsx',
          args: ['src/dev.ts'],
          cwd: `/w/${args.paneRef.role}`,
          env: { PORT: String(args.port), NODE_ENV: 'development' },
        }
      },
    },
  })
  const services = { app: '/w/pr', worker: '/w/pr' }
  const reserved = await p.reserveServices({ paneRef: PR, services })
  await p.launchServices({
    paneRef: PR,
    services,
    env: { app: { DATABASE_URL: 'postgres://pane', NODE_ENV: 'production' } },
    reserved,
  })

  assert.deepEqual(seen.map(({ name, ref, port, env }) => ({ name, ref, port, env })), [
    { name: 'app', ref: '/w/pr', port: 4000, env: { DATABASE_URL: 'postgres://pane', NODE_ENV: 'production' } },
    { name: 'worker', ref: '/w/pr', port: 4001, env: {} },
  ])
  assert.equal(seen[0].paneRef, PR)
  // no HOME, no token, no cloud credentials: only PATH and what was declared
  assert.deepEqual(spawned[0].opts.env, {
    PATH: '/usr/bin:/bin', DATABASE_URL: 'postgres://pane', NODE_ENV: 'development', PORT: '4000',
  })
  assert.deepEqual(spawned[1].opts.env, { PATH: '/usr/bin:/bin', NODE_ENV: 'development', PORT: '4001' })
  for (const { cmd, args, opts } of spawned) {
    assert.equal(cmd, '/w/node_modules/.bin/tsx')
    assert.deepEqual(args, ['src/dev.ts'])
    assert.equal(opts.cwd, '/w/pr')
    assert.equal(opts.detached, true)
    assert.deepEqual(opts.stdio, ['ignore', 'pipe', 'pipe'])
  }
})

test('each spawn is persisted to pids.json via a 0600 tmp file and a rename, in a 0700 stateDir', async () => {
  const { p, fsx } = setup()
  await launch(p, BASE)
  assert.deepEqual(readPids(fsx), [{
    pid: 1001, startedAt: 't1001', paneRole: 'base', kind: 'service', name: 'app', cmd: '/w/bin/app', args: ['--port', '4000'],
  }])
  assert.deepEqual(fsx.ops.find(o => o[0] === 'mkdir'), ['mkdir', STATE_DIR, { recursive: true, mode: 0o700 }])
  const writes = fsx.ops.filter(o => o[0] === 'writeFile')
  const renames = fsx.ops.filter(o => o[0] === 'rename')
  assert.ok(writes.length >= 1)
  for (const [, path, opts] of writes) {
    assert.notEqual(path, PIDFILE)
    assert.ok(path.startsWith(`${STATE_DIR}/`))
    assert.equal(opts.mode, 0o600)
  }
  assert.deepEqual(renames.map(([, from, to]) => [from, to]), writes.map(([, path]) => [path, PIDFILE]))
})

test('pidfile writes are serialized, so concurrent launches keep each other\'s entries', async () => {
  const { p, fsx } = setup()
  let inFlight = 0
  let maxInFlight = 0
  const writeFile = fsx.writeFile
  const rename = fsx.rename
  fsx.writeFile = async (...args) => {
    maxInFlight = Math.max(maxInFlight, ++inFlight)
    await new Promise(resolve => setImmediate(resolve))
    return writeFile(...args)
  }
  fsx.rename = async (...args) => {
    await rename(...args)
    inFlight--
  }
  await Promise.all([launch(p, BASE), launch(p, PR)])
  assert.equal(maxInFlight, 1)
  assert.deepEqual(readPids(fsx).map(e => e.paneRole).sort(), ['base', 'pr'])
})

test('a symlinked or foreign-owned stateDir is refused before anything spawns', async () => {
  for (const [dir, pattern] of [[{ symlink: true }, /symlink/], [{ uid: process.getuid() + 1 }, /owned/]]) {
    const { p, fsx, spawned } = setup()
    Object.assign(fsx.dir, dir)
    await assert.rejects(launch(p, BASE), pattern)
    assert.equal(spawned.length, 0)
  }
})

test('a stateDir open to group or others is tightened to 0700', async () => {
  const { p, fsx } = setup()
  fsx.dir.mode = 0o40755
  await launch(p, BASE)
  assert.deepEqual(fsx.ops.find(o => o[0] === 'chmod'), ['chmod', STATE_DIR, 0o700])
})

test('a spawn error rejects with the command and cwd, records no pid and does not crash', async () => {
  const psCalls = []
  const { p, fsx, groups } = setup({
    deps: {
      spawnFn: cmd => {
        // node reports ENOENT/EACCES asynchronously, on a child with no pid
        const child = fakeChild(undefined)
        process.nextTick(() => child.emit('error', Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' })))
        return child
      },
      psFn: async pid => { psCalls.push(pid); return null },
    },
  })
  await assert.rejects(launch(p, BASE), { message: 'app: failed to start /w/bin/app in /w: spawn /w/bin/app ENOENT' })
  assert.deepEqual(psCalls, [])
  assert.equal(fsx.files.has(PIDFILE), false)
  await p.teardown({ paneRef: BASE })
  assert.deepEqual(groups.calls, [])

  const sync = setup({ deps: { spawnFn: () => { throw new Error('spawn EAGAIN') } } })
  await assert.rejects(launch(sync.p, BASE), { message: 'app: failed to start /w/bin/app in /w: spawn EAGAIN' })
})

test('a failed spawn keeps the processes already started recorded, so teardown still kills them', async () => {
  let calls = 0
  const failing = setup({
    deps: {
      spawnFn: () => {
        calls++
        const child = fakeChild(calls === 1 ? 1001 : undefined)
        if (calls === 1) failing.groups.alive.add(1001)
        else process.nextTick(() => child.emit('error', new Error('spawn EACCES')))
        return child
      },
    },
  })
  await assert.rejects(launch(failing.p, BASE, { app: '/w', worker: '/w' }), /worker: failed to start/)
  assert.deepEqual(readPids(failing.fsx).map(e => e.pid), [1001])
  await failing.p.teardown({ paneRef: BASE })
  assert.deepEqual(failing.groups.calls[0], [-1001, 'SIGTERM'])
  assert.deepEqual(readPids(failing.fsx), [])
})

test('launchServices checks the signal immediately before every spawn', async () => {
  const a = setup()
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(launch(a.p, BASE, { app: '/w' }, {}, ac.signal), { name: 'AbortError' })
  assert.equal(a.spawned.length, 0)

  // aborted after the first spawn: the second service never starts
  const ac2 = new AbortController()
  const b = setup({ deps: { psFn: async pid => { ac2.abort(); return { startedAt: `t${pid}` } } } })
  await assert.rejects(launch(b.p, BASE, { app: '/w', worker: '/w' }, {}, ac2.signal), { name: 'AbortError' })
  assert.deepEqual(b.spawned.map(s => s.cmd), ['/w/bin/app'])
})

// --- reserveServices -----------------------------------------------------------

test('reserved ports never collide, across services and panes, until teardown frees them', async () => {
  const offered = [4000, 4000, 4001, 4000, 4001, 4002, 4000]
  const hosts = []
  const s = setup({ deps: { freePortFn: async host => { hosts.push(host); return offered.shift() } } })
  const base = await s.p.reserveServices({ paneRef: BASE, services: { app: 'b' } })
  const pr = await s.p.reserveServices({ paneRef: PR, services: { app: 'p', worker: 'p' } })
  assert.deepEqual(base, { app: { url: 'http://127.0.0.1:4000', port: 4000 } })
  assert.deepEqual(pr, {
    app: { url: 'http://127.0.0.1:4001', port: 4001 },
    worker: { url: 'http://127.0.0.1:4002', port: 4002 },
  })
  assert.ok(hosts.every(h => h === '127.0.0.1'))
  assert.equal(s.spawned.length, 0) // reserving starts nothing

  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(await s.p.reserveServices({ paneRef: BASE, services: { app: 'b' } }), {
    app: { url: 'http://127.0.0.1:4000', port: 4000 },
  })
})

test('reserveServices gives up when the free-port lookup keeps offering taken ports', async () => {
  const s = setup({ deps: { freePortFn: async () => 4000 } })
  await s.p.reserveServices({ paneRef: BASE, services: { app: 'b' } })
  await assert.rejects(s.p.reserveServices({ paneRef: PR, services: { app: 'p' } }), /no free port/)
})

test('an IPv6 host is bracketed in reserved urls', async () => {
  const s = setup({ deps: { host: '::1' } })
  assert.deepEqual(await s.p.reserveServices({ paneRef: BASE, services: { app: 'b' } }), {
    app: { url: 'http://[::1]:4000', port: 4000 },
  })
})

// --- waitHealthy ----------------------------------------------------------------

test('waitHealthy polls each service\'s health path until healthy, aborting every fetch', async () => {
  const urls = []
  const signals = []
  const statuses = [503, 200, 200]
  const s = setup({
    deps: {
      healthPath: name => (name === 'app' ? '/ui/' : '/health'),
      fetchFn: async (url, { signal }) => {
        urls.push(url)
        signals.push(signal)
        return { status: statuses.shift() }
      },
    },
  })
  const reserved = await launch(s.p, BASE, { app: '/w', worker: '/w' })
  await s.p.waitHealthy({ services: reserved })
  assert.deepEqual(urls, ['http://127.0.0.1:4000/ui/', 'http://127.0.0.1:4000/ui/', 'http://127.0.0.1:4001/health'])
  assert.ok(signals.every(sig => sig.aborted))

  const d = setup({ deps: { fetchFn: async url => { urls.push(url); return { status: 200 } } } })
  await d.p.waitHealthy({ services: await launch(d.p, BASE) })
  assert.equal(urls.at(-1), 'http://127.0.0.1:4000/')
})

test('the healthy predicate decides what counts as up', async () => {
  const statuses = [404, 302, 200]
  const s = setup({ deps: { healthy: status => status === 200, fetchFn: async () => ({ status: statuses.shift() }) } })
  await s.p.waitHealthy({ services: await launch(s.p, BASE) })
  assert.equal(statuses.length, 0)

  // the default accepts anything below 500
  let fetches = 0
  const d = setup({ deps: { fetchFn: async () => { fetches++; return { status: 404 } } } })
  await d.p.waitHealthy({ services: await launch(d.p, BASE) })
  assert.equal(fetches, 1)
})

test('a service that exits while being waited on fails at once with the log tail', async () => {
  let fetches = 0
  const s = setup({
    deps: {
      fetchFn: () => {
        fetches++
        setImmediate(() => {
          const { child } = s.spawned[0]
          child.stderr.emit('data', 'Error: Cannot find module\n')
          child.emit('close', 1, null)
        })
        return new Promise(() => {})
      },
    },
  })
  const reserved = await launch(s.p, BASE)
  await assert.rejects(s.p.waitHealthy({ services: reserved }), err => {
    assert.equal(err.message, 'app exited before it was healthy (code 1)')
    assert.match(err.logTail, /\[app\] Error: Cannot find module/)
    return true
  })
  assert.equal(fetches, 1)
})

test('a hung health check stops at the deadline, with every fetch signal aborted', async () => {
  const signals = []
  const s = setup({
    deps: {
      healthTimeoutMs: 5000,
      fetchFn: (url, { signal }) => {
        signals.push(signal)
        return new Promise(() => {})
      },
    },
  })
  const reserved = await launch(s.p, BASE)
  s.spawned[0].child.stdout.emit('data', 'listening soon\n')
  await assert.rejects(s.p.waitHealthy({ services: reserved }), err => {
    assert.equal(err.message, 'app on port 4000 not healthy after 5000ms')
    assert.match(err.logTail, /\[app\] listening soon/)
    return true
  })
  assert.ok(signals.length >= 2)
  assert.ok(signals.every(sig => sig.aborted))
  assert.ok(s.now() >= 5000)
})

test('an aborted signal stops waitHealthy with an AbortError', async () => {
  const ac = new AbortController()
  const s = setup({
    deps: {
      fetchFn: () => {
        setImmediate(() => ac.abort())
        return new Promise(() => {})
      },
    },
  })
  const reserved = await launch(s.p, BASE)
  await assert.rejects(s.p.waitHealthy({ services: reserved, signal: ac.signal }), { name: 'AbortError' })
})

// --- provisionDatabase ------------------------------------------------------------

test('provisionDatabase without a database starts nothing', async () => {
  const s = setup()
  assert.deepEqual(await s.p.provisionDatabase({ paneRef: BASE, databases: [] }), { dsn: null, db: null })
  assert.equal(s.spawned.length, 0)
})

test('provisionDatabase spawns the database with exactly PATH and its env, waits for ready, returns handle', async () => {
  const readyCalls = []
  const s = setup({ deps: { database: fakeDb({ ready: async args => { readyCalls.push(args) } }) } })
  const out = await s.p.provisionDatabase({ paneRef: BASE, databases: [] })
  assert.deepEqual(out, { dsn: 'http://127.0.0.1:4000', db: { role: 'base', port: 4000 } })

  const [{ cmd, args, opts }] = s.spawned
  assert.equal(cmd, '/usr/bin/java')
  assert.deepEqual(args, ['-jar', 'DynamoDBLocal.jar', '-port', '4000'])
  assert.equal(opts.cwd, '/opt/ddb')
  assert.deepEqual(opts.env, { PATH: '/usr/bin:/bin', JAVA_OPTS: '-Xmx256m' })
  assert.equal(opts.detached, true)
  assert.deepEqual(opts.stdio, ['ignore', 'pipe', 'pipe'])

  assert.equal(readyCalls[0].port, 4000)
  assert.ok(readyCalls[0].signal instanceof AbortSignal)
  assert.equal(readyCalls[0].signal.aborted, false)
  assert.deepEqual(readPids(s.fsx), [{
    pid: 1001, startedAt: 't1001', paneRole: 'base', kind: 'database', name: 'database',
    cmd: '/usr/bin/java', args: ['-jar', 'DynamoDBLocal.jar', '-port', '4000'],
  }])
})

test('a database that exits before it is ready rejects with the log tail and aborts ready\'s signal', async () => {
  let readySignal
  const s = setup({
    deps: {
      database: fakeDb({
        ready: ({ signal }) => {
          readySignal = signal
          setImmediate(() => {
            const { child } = s.spawned[0]
            child.stderr.emit('data', 'Address already in use\n')
            child.emit('close', 1, null)
          })
          return new Promise(() => {}) // even a ready check that ignores its signal can't hang the boot
        },
      }),
    },
  })
  await assert.rejects(s.p.provisionDatabase({ paneRef: BASE }), err => {
    assert.equal(err.message, 'database exited before it was ready (code 1)')
    assert.match(err.logTail, /\[database\] Address already in use/)
    return true
  })
  assert.equal(readySignal.aborted, true)
})

test('provisionDatabase honours an abort before spawning and while waiting for ready', async () => {
  const ac = new AbortController()
  ac.abort()
  let ports = 0
  const a = setup({ deps: { database: fakeDb(), freePortFn: async () => 4000 + ports++ } })
  await assert.rejects(a.p.provisionDatabase({ paneRef: BASE, signal: ac.signal }), { name: 'AbortError' })
  assert.equal(ports, 1) // the port is picked, then the signal checked
  assert.equal(a.spawned.length, 0)

  const ac2 = new AbortController()
  let readySignal
  const b = setup({
    deps: {
      database: fakeDb({
        ready: ({ signal }) => {
          readySignal = signal
          setImmediate(() => ac2.abort())
          return new Promise(() => {})
        },
      }),
    },
  })
  await assert.rejects(b.p.provisionDatabase({ paneRef: BASE, signal: ac2.signal }), { name: 'AbortError' })
  assert.equal(readySignal.aborted, true)
})

// --- teardown -----------------------------------------------------------------------

test('teardown stops services before the database, signalling process groups', async () => {
  const s = setup({ deps: { database: fakeDb() } })
  await s.p.provisionDatabase({ paneRef: BASE }) // 1001
  await launch(s.p, BASE) // 1002
  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(s.groups.calls, [[-1002, 'SIGTERM'], [-1002, 0], [-1001, 'SIGTERM'], [-1001, 0]])
  assert.deepEqual(readPids(s.fsx), [])
})

test('teardown keeps probing the group after its leader exits on TERM, then SIGKILLs it after graceMs', async () => {
  const s = setup({ deps: { graceMs: 1000 } })
  await launch(s.p, BASE)
  const { child } = s.spawned[0]
  s.groups.survivesTerm.add(1001)
  let killedAt = null
  s.groups.hooks.onSignal = (pgid, sig) => {
    if (sig === 'SIGTERM') child.emit('close', null, 'SIGTERM') // the leader goes; its group doesn't
    if (sig === 'SIGKILL') killedAt = s.now()
  }
  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(s.groups.calls[0], [-1001, 'SIGTERM'])
  assert.ok(s.groups.calls.every(([pid]) => pid === -1001)) // never the bare leader pid
  const killIndex = s.groups.calls.findIndex(([, sig]) => sig === 'SIGKILL')
  assert.ok(killIndex > 10, 'probed every 100ms through the grace period')
  assert.ok(killedAt >= 1000)
  assert.deepEqual(s.groups.calls.at(-1), [-1001, 0]) // probed again until ESRCH
  assert.deepEqual(readPids(s.fsx), [])
})

test('a group that survives SIGKILL keeps its pidfile entry, is logged, and goes once it reports ESRCH', async () => {
  const s = setup({ deps: { graceMs: 300 } })
  await launch(s.p, BASE)
  s.groups.survivesTerm.add(1001)
  s.groups.survivesKill.add(1001)
  await s.p.teardown({ paneRef: BASE })
  assert.ok(s.groups.calls.some(([, sig]) => sig === 'SIGKILL'))
  assert.deepEqual(readPids(s.fsx).map(e => e.pid), [1001])
  assert.match(s.warnings.join('\n'), /1001/)

  s.groups.alive.delete(1001)
  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(readPids(s.fsx), [])
})

test('teardown tolerates ESRCH on TERM and treats EPERM on the probe as gone', async () => {
  const a = setup()
  await launch(a.p, BASE)
  a.groups.alive.delete(1001)
  await a.p.teardown({ paneRef: BASE })
  assert.deepEqual(a.groups.calls, [[-1001, 'SIGTERM']])
  assert.deepEqual(readPids(a.fsx), [])

  const calls = []
  const b = setup({
    deps: {
      killFn: (pid, sig) => {
        calls.push([pid, sig])
        if (sig === 0) throw errno('EPERM') // what macOS reports for a group of zombies
      },
    },
  })
  await launch(b.p, BASE)
  await b.p.teardown({ paneRef: BASE })
  assert.deepEqual(calls, [[-1001, 'SIGTERM'], [-1001, 0]])
  assert.deepEqual(readPids(b.fsx), [])
})

test('teardown is idempotent and never signals pid 1', async () => {
  const s = setup()
  await launch(s.p, BASE)
  await s.p.teardown({ paneRef: BASE })
  const signalled = s.groups.calls.length
  await s.p.teardown({ paneRef: BASE })
  await s.p.teardown({ paneRef: PR }) // never launched
  assert.equal(s.groups.calls.length, signalled)

  // kill(-1) would signal every process we own: pid 1 is never a group to kill
  const one = setup({ pids: [1] })
  await launch(one.p, BASE)
  one.exitHooks.forEach(hook => hook())
  await one.p.teardown({ paneRef: BASE })
  assert.deepEqual(one.groups.calls, [])
})

// --- sweep ------------------------------------------------------------------------------

test('sweep kills our orphaned groups by start time, skips reused pids and finds leaderless groups', async () => {
  const ps = { 501: { startedAt: 'A' }, 502: { startedAt: 'someone else' } }
  const pgroupCalls = []
  const s = setup({
    deps: {
      psFn: async pid => ps[pid] ?? null,
      pgroupFn: async pgid => {
        pgroupCalls.push(pgid)
        return pgid === 503 ? [7001, 7002] : []
      },
    },
  })
  s.fsx.files.set(PIDFILE, JSON.stringify([
    entry(501, 'A'), // leader alive and ours
    entry(502, 'B'), // pid now belongs to another process
    entry(503, 'C'), // leader gone, group still has members
    entry(504, 'D'), // leader and group gone
    entry(1, 'E'), // never a pid we would signal
  ]))
  for (const pid of [501, 502, 503]) s.groups.alive.add(pid)
  await s.p.sweep()
  assert.deepEqual([...new Set(s.groups.calls.map(([pid]) => pid))], [-501, -503])
  assert.deepEqual(s.groups.calls.filter(([, sig]) => sig === 'SIGTERM'), [[-501, 'SIGTERM'], [-503, 'SIGTERM']])
  assert.deepEqual(pgroupCalls, [503, 504])
  assert.deepEqual(readPids(s.fsx), [])
  assert.ok(s.groups.alive.has(502))
})

test('sweep removes only the entries it processed, keeping new ones and survivors', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const s = setup({
    deps: {
      graceMs: 200,
      psFn: async pid => {
        if (pid === 501) await gate
        return { startedAt: pid === 501 ? 'A' : pid === 502 ? 'B' : `t${pid}` }
      },
    },
  })
  s.fsx.files.set(PIDFILE, JSON.stringify([entry(501, 'A'), entry(502, 'B')]))
  s.groups.alive.add(501)
  s.groups.alive.add(502)
  s.groups.survivesTerm.add(502)
  s.groups.survivesKill.add(502)
  const sweeping = s.p.sweep()
  await launch(s.p, BASE) // pid 1001, persisted while the sweep waits on ps
  release()
  await sweeping
  assert.deepEqual(readPids(s.fsx).map(e => e.pid).sort(), [1001, 502])
  assert.match(s.warnings.join('\n'), /502/)
})

test('sweep treats a missing or corrupt pidfile as empty', async () => {
  const a = setup()
  await a.p.sweep()
  assert.deepEqual(a.groups.calls, [])

  const b = setup()
  b.fsx.files.set(PIDFILE, '{not json')
  await b.p.sweep()
  assert.deepEqual(b.groups.calls, [])
})

test('sweep never touches this instance\'s own live processes', async () => {
  const s = setup()
  await launch(s.p, BASE)
  await s.p.sweep()
  assert.deepEqual(s.groups.calls, [])
  assert.deepEqual(readPids(s.fsx).map(e => e.pid), [1001])
})

// --- exit hook --------------------------------------------------------------------------

test('an exit hook registered on the first spawn SIGKILLs every live group synchronously', async () => {
  const s = setup({ deps: { database: fakeDb() } })
  await s.p.reserveServices({ paneRef: BASE, services: { app: '/w' } })
  assert.equal(s.exitHooks.length, 0)
  await s.p.provisionDatabase({ paneRef: BASE }) // 1001
  await launch(s.p, BASE) // 1002
  await launch(s.p, PR) // 1003
  await s.p.teardown({ paneRef: PR })
  assert.equal(s.exitHooks.length, 1)

  s.groups.calls.length = 0
  s.groups.alive.delete(1001) // an already-gone group must not stop the rest
  s.exitHooks[0]()
  assert.deepEqual(s.groups.calls.sort(), [[-1001, 'SIGKILL'], [-1002, 'SIGKILL']])
})

// --- logs -------------------------------------------------------------------------------

test('logs keep the last logLines lines per pane, survive teardown and reset on the next launch', async () => {
  const s = setup({ deps: { logLines: 3 } })
  await launch(s.p, BASE)
  const { child } = s.spawned[0]
  child.stdout.emit('data', Buffer.from('one\ntw'))
  child.stdout.emit('data', Buffer.from('o\nthree\n'))
  child.stderr.emit('data', 'four\n')
  const tail = lines => s.p.logs({ paneRef: BASE, stage: 'starting', lines })
  assert.equal(await tail(), '[app] two\n[app] three\n[app] four')
  assert.equal(await tail(1), '[app] four')
  assert.equal(await s.p.logs({ paneRef: PR, stage: 'starting' }), '')

  await s.p.teardown({ paneRef: BASE })
  assert.equal(await tail(), '[app] two\n[app] three\n[app] four')

  await launch(s.p, BASE)
  assert.equal(await tail(), '')
  s.spawned[1].child.stdout.emit('data', 'fresh\n')
  assert.equal(await tail(), '[app] fresh')
})

test('the database\'s lines stay in the pane buffer when its services launch', async () => {
  const s = setup({ deps: { database: fakeDb() } })
  await s.p.provisionDatabase({ paneRef: BASE })
  s.spawned[0].child.stderr.emit('data', 'db up\n')
  await launch(s.p, BASE)
  s.spawned[1].child.stdout.emit('data', 'app up\n')
  assert.equal(await s.p.logs({ paneRef: BASE, stage: 'starting' }), '[database] db up\n[app] app up')

  // the next boot's provisionDatabase starts a fresh buffer
  await s.p.teardown({ paneRef: BASE })
  await s.p.provisionDatabase({ paneRef: BASE })
  assert.equal(await s.p.logs({ paneRef: BASE, stage: 'cloning' }), '')
})
