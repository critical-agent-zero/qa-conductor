// Tests for the process Provisioner. Every effect is faked: children are
// EventEmitters, kill acts on an in-memory process-group table, ps, the group
// listing and the boot id are scripted, the filesystem is a Map, and the clock
// moves only when the code sleeps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, getEventListeners } from 'node:events'
// Through the package's own exports map, the way a consumer imports it.
import { createProcessProvisioner } from '@critical-labs/qa-conductor/adapters/provisioner-process'

const STATE_DIR = '/state'
const PIDFILE = '/state/pids.json'
const BASE = { role: 'base' }
const PR = { role: 'pr' }
const BOOT = 'boot-1'

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

// `links` are symlinks (path -> target), which writeFile follows unless it
// creates exclusively; `owners` overrides a file's uid.
function memFs() {
  const files = new Map()
  const links = new Map()
  const owners = new Map()
  const ops = []
  const dir = { symlink: false, directory: true, uid: process.getuid(), mode: 0o40700 }
  const enoent = path => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  const stat = (kind, uid, mode) => ({
    isSymbolicLink: () => kind === 'link', isDirectory: () => kind === 'dir', isFile: () => kind === 'file', uid, mode,
  })
  return {
    files,
    links,
    owners,
    ops,
    dir,
    async mkdir(path, opts) { ops.push(['mkdir', path, opts]) },
    async lstat(path) {
      if (path === STATE_DIR) return dir.symlink ? stat('link', dir.uid, 0o120777) : stat(dir.directory ? 'dir' : 'file', dir.uid, dir.mode)
      if (links.has(path)) return stat('link', process.getuid(), 0o120777)
      if (!files.has(path)) throw enoent(path)
      return stat('file', owners.get(path) ?? process.getuid(), 0o100600)
    },
    async chmod(path, mode) { ops.push(['chmod', path, mode]) },
    async readFile(path) {
      const real = links.get(path) ?? path
      if (!files.has(real)) throw enoent(path)
      return files.get(real)
    },
    async writeFile(path, data, opts) {
      ops.push(['writeFile', path, opts])
      if (opts?.flag === 'wx' && (files.has(path) || links.has(path))) {
        throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' })
      }
      files.set(links.get(path) ?? path, String(data))
    },
    async unlink(path) {
      ops.push(['unlink', path])
      if (!links.delete(path) && !files.delete(path)) throw enoent(path)
      owners.delete(path)
    },
    async rename(from, to) {
      ops.push(['rename', from, to])
      files.set(to, files.get(from))
      files.delete(from)
      links.delete(to)
      owners.delete(to)
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
    bootIdFn: async () => BOOT,
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
const entry = (pid, startedAt, bootId = BOOT) =>
  ({ pid, startedAt, bootId, paneRole: 'base', kind: 'service', name: 'app', cmd: '/w/bin/app', args: [] })

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
    pid: 1001, startedAt: 't1001', bootId: BOOT, paneRole: 'base', kind: 'service', name: 'app', cmd: '/w/bin/app', args: ['--port', '4000'],
  }])
  assert.deepEqual(fsx.ops.find(o => o[0] === 'mkdir'), ['mkdir', STATE_DIR, { recursive: true, mode: 0o700 }])
  const writes = fsx.ops.filter(o => o[0] === 'writeFile')
  const renames = fsx.ops.filter(o => o[0] === 'rename')
  assert.ok(writes.length >= 1)
  for (const [, path, opts] of writes) {
    assert.notEqual(path, PIDFILE)
    assert.ok(path.startsWith(`${STATE_DIR}/`))
    assert.equal(opts.mode, 0o600)
    assert.equal(opts.flag, 'wx') // created afresh, never through something already there
  }
  assert.deepEqual(renames.map(([, from, to]) => [from, to]), writes.map(([, path]) => [path, PIDFILE]))
})

test('a file or symlink left at the tmp path is replaced, never written through', async () => {
  const { p, fsx } = setup()
  const tmp = `${PIDFILE}.${process.pid}.tmp`
  fsx.files.set('/home/me/.ssh/authorized_keys', 'ssh-ed25519 AAAA me')
  fsx.links.set(tmp, '/home/me/.ssh/authorized_keys')
  await launch(p, BASE)
  assert.equal(fsx.files.get('/home/me/.ssh/authorized_keys'), 'ssh-ed25519 AAAA me')
  assert.deepEqual(readPids(fsx).map(e => e.pid), [1001])
  assert.equal(fsx.links.has(tmp), false)
  assert.equal(fsx.files.has(tmp), false)
})

test('a pids.json that is a symlink or owned by another uid is ignored, then replaced', async () => {
  for (const plant of [
    fsx => fsx.owners.set(PIDFILE, process.getuid() + 1),
    fsx => {
      fsx.files.set('/elsewhere/pids.json', fsx.files.get(PIDFILE))
      fsx.files.delete(PIDFILE)
      fsx.links.set(PIDFILE, '/elsewhere/pids.json')
    },
  ]) {
    const s = setup({ deps: { psFn: async pid => ({ startedAt: pid === 501 ? 'A' : `t${pid}` }) } })
    s.fsx.files.set(PIDFILE, JSON.stringify([entry(501, 'A')])) // the victim's own shell, say
    plant(s.fsx)
    s.groups.alive.add(501)
    await s.p.sweep()
    assert.deepEqual(s.groups.calls, [])
    assert.match(s.warnings.join('\n'), /pids\.json is not a regular file owned by uid/)

    await launch(s.p, BASE)
    assert.deepEqual(readPids(s.fsx).map(e => e.pid), [1001])
    assert.equal(s.fsx.links.has(PIDFILE), false)
    if (s.fsx.files.has('/elsewhere/pids.json')) assert.match(s.fsx.files.get('/elsewhere/pids.json'), /501/)
  }
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

test('a stateDir readable by group or others is tightened to 0700', async () => {
  const { p, fsx } = setup()
  fsx.dir.mode = 0o40755
  await launch(p, BASE)
  assert.deepEqual(fsx.ops.find(o => o[0] === 'chmod'), ['chmod', STATE_DIR, 0o700])
})

test('a stateDir writable by group or others is refused, since its contents may be planted', async () => {
  for (const mode of [0o40777, 0o40720, 0o40702]) {
    const { p, fsx, spawned, groups } = setup()
    fsx.dir.mode = mode
    fsx.files.set(PIDFILE, JSON.stringify([entry(501, 't501')]))
    groups.alive.add(501)
    await assert.rejects(p.sweep(), /writable by group or others/)
    await assert.rejects(launch(p, BASE), /writable by group or others/)
    assert.equal(spawned.length, 0)
    assert.deepEqual(groups.calls, [])
    assert.equal(fsx.ops.some(o => o[0] === 'chmod'), false)
  }
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
  const opts = []
  const statuses = [503, 200, 200]
  const s = setup({
    deps: {
      healthPath: name => (name === 'app' ? '/ui/' : '/health'),
      fetchFn: async (url, o) => {
        urls.push(url)
        opts.push(o)
        return { status: statuses.shift() }
      },
    },
  })
  const reserved = await launch(s.p, BASE, { app: '/w', worker: '/w' })
  await s.p.waitHealthy({ services: reserved })
  assert.deepEqual(urls, ['http://127.0.0.1:4000/ui/', 'http://127.0.0.1:4000/ui/', 'http://127.0.0.1:4001/health'])
  assert.ok(opts.every(o => o.signal.aborted))
  // the service's own status: a redirect to the pane proxy would answer 503 mid-boot
  assert.ok(opts.every(o => o.redirect === 'manual'))

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

test('health attempts leave no listeners behind on the caller\'s signal', async () => {
  const ac = new AbortController()
  const seen = []
  const statuses = [503, 503, 503, 200]
  const s = setup({
    deps: {
      fetchFn: async () => {
        seen.push(getEventListeners(ac.signal, 'abort').length)
        return { status: statuses.shift() }
      },
    },
  })
  await s.p.waitHealthy({ services: await launch(s.p, BASE), signal: ac.signal })
  assert.deepEqual(seen, [1, 1, 1, 1]) // one per attempt in flight, never more
  assert.equal(getEventListeners(ac.signal, 'abort').length, 0)
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
    pid: 1001, startedAt: 't1001', bootId: BOOT, paneRole: 'base', kind: 'database', name: 'database',
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

  // with the caller's signal too, as the core passes it: either one aborts ready
  const ac = new AbortController()
  let withCaller
  const c = setup({
    deps: {
      database: fakeDb({
        ready: ({ signal }) => {
          withCaller = signal
          setImmediate(() => {
            c.spawned[0].child.stderr.emit('data', 'OutOfMemoryError\n')
            c.spawned[0].child.emit('close', null, 'SIGKILL')
          })
          return new Promise(() => {})
        },
      }),
    },
  })
  await assert.rejects(c.p.provisionDatabase({ paneRef: BASE, signal: ac.signal }), err => {
    assert.equal(err.message, 'database exited before it was ready (signal SIGKILL)')
    assert.match(err.logTail, /\[database\] OutOfMemoryError/)
    return true
  })
  assert.equal(withCaller.aborted, true)
  assert.equal(ac.signal.aborted, false)
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

// A pane whose service leader has exited, as node reports it: reaped, then
// 'exit', then 'close'. `ps` answers from `ps.fn` once the launch is done.
async function exitedLeader({ groupEmpty, deps } = {}) {
  const ps = { fn: pid => ({ startedAt: `t${pid}` }) }
  const s = setup({ deps: { psFn: async pid => ps.fn(pid), ...deps } })
  await launch(s.p, BASE)
  const { child } = s.spawned[0]
  if (groupEmpty) s.groups.alive.delete(1001)
  child.emit('exit', 1, null)
  child.emit('close', 1, null)
  return { ...s, ps }
}

const signalsTo = (s, pid) => s.groups.calls.filter(([p, sig]) => p === -pid && sig !== 0)

test('a crashed service\'s reissued pid gets no signal from teardown or the exit hook', async () => {
  const s = await exitedLeader({ groupEmpty: true })
  // the group was empty when its leader was reaped, so the pid went back to the pool
  s.groups.alive.add(1001)
  s.ps.fn = () => ({ startedAt: 'someone else' })
  s.exitHooks[0]()
  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(signalsTo(s, 1001), [])
  assert.ok(s.groups.alive.has(1001))
  assert.deepEqual(readPids(s.fsx), [])
})

test('a wrapper\'s orphans are still stopped after the wrapper exits', async () => {
  for (const run of ['teardown', 'exit hook']) {
    const s = await exitedLeader({ deps: { graceMs: 300 } })
    s.ps.fn = () => null
    s.groups.survivesTerm.add(1001)
    if (run === 'teardown') {
      await s.p.teardown({ paneRef: BASE })
      assert.deepEqual(signalsTo(s, 1001), [[-1001, 'SIGTERM'], [-1001, 'SIGKILL']])
      assert.deepEqual(readPids(s.fsx), [])
    } else {
      s.exitHooks[0]()
      assert.deepEqual(signalsTo(s, 1001), [[-1001, 'SIGKILL']])
    }
  }

  // a wrapper gone before ps even saw it: no start time was recorded
  const unknown = setup({ deps: { psFn: async () => null } })
  await launch(unknown.p, BASE)
  unknown.spawned[0].child.emit('exit', 0, null)
  unknown.spawned[0].child.emit('close', 0, null)
  await unknown.p.teardown({ paneRef: BASE })
  assert.deepEqual(signalsTo(unknown, 1001)[0], [-1001, 'SIGTERM'])
  assert.match(unknown.warnings.join('\n'), /could not read the start time of pid 1001/)
})

test('once a wrapper\'s orphans are gone, its reissued pid gets no signal from teardown', async () => {
  const s = await exitedLeader()
  s.groups.alive.delete(1001) // the orphans exit...
  s.groups.alive.add(1001) // ...and the pid is reissued
  s.ps.fn = () => ({ startedAt: 'someone else' })
  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(signalsTo(s, 1001), [])
  assert.deepEqual(readPids(s.fsx), [])
})

test('a group that ends between teardown\'s probes is not signalled again, though its pid is reissued', async () => {
  const s = setup({ deps: { graceMs: 1000 } })
  await launch(s.p, BASE)
  const { child } = s.spawned[0]
  s.groups.survivesTerm.add(1001)
  let probes = 0
  s.groups.hooks.onSignal = (pgid, sig) => {
    if (sig !== 0 || ++probes !== 3) return
    s.groups.alive.delete(1001) // the group ends and its leader is reaped...
    child.emit('exit', null, 'SIGTERM')
    s.groups.alive.add(1001) // ...and the pid goes to someone else's group
  }
  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(signalsTo(s, 1001), [[-1001, 'SIGTERM']])
  assert.deepEqual(readPids(s.fsx), [])
})

test('when ps fails for an exited leader, teardown leaves it unsignalled and kept, and stops the rest', async () => {
  const ps = { fn: pid => ({ startedAt: `t${pid}` }) }
  const s = setup({ deps: { psFn: async pid => ps.fn(pid) } })
  await launch(s.p, BASE, { app: '/w', worker: '/w' }) // 1001, 1002
  s.spawned[0].child.emit('exit', 1, null)
  s.spawned[0].child.emit('close', 1, null)
  ps.fn = pid => {
    if (pid === 1001) throw new Error('ps: fork failed')
    return { startedAt: `t${pid}` }
  }
  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(signalsTo(s, 1001), [])
  assert.deepEqual(signalsTo(s, 1002), [[-1002, 'SIGTERM']])
  assert.deepEqual(readPids(s.fsx).map(e => e.pid), [1001])
  assert.match(s.warnings.join('\n'), /could not check whether pid 1001 is still ours/)

  // the next teardown retries it
  ps.fn = () => null
  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(signalsTo(s, 1001), [[-1001, 'SIGTERM']])
  assert.deepEqual(readPids(s.fsx), [])
})

test('a teardown while ps is still running leaves no pidfile entry behind', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const s = setup({ deps: { psFn: async pid => { await gate; return { startedAt: `t${pid}` } } } })
  const services = { app: '/w' }
  const reserved = await s.p.reserveServices({ paneRef: BASE, services })
  const launching = s.p.launchServices({ paneRef: BASE, services, reserved })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(s.spawned.length, 1) // spawned, its ps still pending
  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(s.groups.calls[0], [-1001, 'SIGTERM'])
  release()
  await launching
  assert.deepEqual(readPids(s.fsx), [])
})

test('an error on a child\'s output stream is contained', async () => {
  const s = setup()
  const reserved = await launch(s.p, BASE)
  const { child } = s.spawned[0]
  assert.doesNotThrow(() => {
    child.stdout.emit('error', new Error('EPIPE'))
    child.stderr.emit('error', new Error('EPIPE'))
  })
  await s.p.waitHealthy({ services: reserved })
  await s.p.teardown({ paneRef: BASE })
  assert.deepEqual(readPids(s.fsx), [])
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
    entry(505, null), // no start time to check against
  ]))
  for (const pid of [501, 502, 503, 505]) s.groups.alive.add(pid)
  await s.p.sweep()
  assert.deepEqual([...new Set(s.groups.calls.map(([pid]) => pid))], [-501, -503])
  assert.deepEqual(s.groups.calls.filter(([, sig]) => sig === 'SIGTERM'), [[-501, 'SIGTERM'], [-503, 'SIGTERM']])
  assert.deepEqual(pgroupCalls, [503, 504])
  // entries it couldn't process stay, for a later sweep after a reboot to clear
  assert.deepEqual(readPids(s.fsx), [entry(1, 'E'), entry(505, null)])
  assert.ok(s.groups.alive.has(502))
})

test('sweep drops entries from an earlier boot without signalling anything', async () => {
  const psCalls = []
  const s = setup({
    deps: {
      psFn: async pid => { psCalls.push(pid); return { startedAt: 'A' } },
      pgroupFn: async () => [7001],
    },
  })
  const { bootId, ...legacy } = entry(503, 'A')
  s.fsx.files.set(PIDFILE, JSON.stringify([entry(501, 'A', 'boot-0'), entry(502, null, 'boot-0'), legacy]))
  for (const pid of [501, 502, 503]) s.groups.alive.add(pid)
  await s.p.sweep()
  assert.deepEqual(s.groups.calls, [])
  assert.deepEqual(psCalls, [])
  assert.deepEqual(readPids(s.fsx), [])
})

test('with no boot id, sweep still acts on start times and leaderless groups', async () => {
  const s = setup({
    deps: {
      bootIdFn: async () => { throw new Error('sysctl: unknown oid') },
      psFn: async pid => (pid === 501 ? { startedAt: 'A' } : null),
      pgroupFn: async pgid => (pgid === 502 ? [7001] : []),
    },
  })
  s.fsx.files.set(PIDFILE, JSON.stringify([entry(501, 'A', 'boot-0'), entry(502, 'B', null)]))
  s.groups.alive.add(501)
  s.groups.alive.add(502)
  await s.p.sweep()
  assert.deepEqual(s.groups.calls.filter(([, sig]) => sig === 'SIGTERM'), [[-501, 'SIGTERM'], [-502, 'SIGTERM']])
  assert.deepEqual(readPids(s.fsx), [])
  assert.match(s.warnings.join('\n'), /no boot id/)

  await launch(s.p, BASE)
  assert.equal(readPids(s.fsx)[0].bootId, null)
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
