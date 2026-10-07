import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SELF_REPO, cacheDirFor, loadSelfQaConfig, runSelfQa, selfQaAdapters, selfQaCommand, selfQaExposure } from '../qa/self.mjs'

const github = { prInfo: async () => ({}), authorPermission: async () => 'write' }
const pane = { publicOrigin: 'http://127.0.0.1:3102', services: { app: { url: 'http://127.0.0.1:45678', port: 45678 } } }

function adapters(overrides = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'self-qa-'))
  return selfQaAdapters({ repo: SELF_REPO, github, cacheDir, execPath: '/usr/local/bin/node', ...overrides })
}

test('cacheDirFor: per repo under XDG_CACHE_HOME, else ~/.cache', () => {
  assert.equal(cacheDirFor('critical-labs/qa-conductor', { XDG_CACHE_HOME: '/x/cache' }, '/fake-home/u'), '/x/cache/qa-conductor/critical-labs-qa-conductor')
  assert.equal(cacheDirFor('critical-labs/qa-conductor', {}, '/fake-home/u'), '/fake-home/u/.cache/qa-conductor/critical-labs-qa-conductor')
})

// The loader runSelfQa uses, exported so `npm run expose` (which passes
// --config qa/self.mjs#loadSelfQaConfig) reads self-QA's .env.qa as self-QA does.
test('loadSelfQaConfig: self-QA\'s .env.qa, with self-QA\'s defaults: this repo and loopback panes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-qa-env-'))
  const file = join(dir, '.env.qa')
  writeFileSync(file, 'GITHUB_QA_TOKEN=tok\n')
  const cfg = loadSelfQaConfig(file)
  assert.equal(cfg.repo, SELF_REPO)
  assert.deepEqual(cfg.paneOrigins, { base: 'http://127.0.0.1:3101', pr: 'http://127.0.0.1:3102' })
  assert.equal(cfg.harnessOrigin, 'http://127.0.0.1:3100')
  assert.equal(cfg.exposure, 'none')
  // the file wins
  writeFileSync(file, ['GITHUB_QA_TOKEN=tok', 'QA_REPO=acme/widget', 'QA_PR_ORIGIN=http://127.0.0.1:4102'].join('\n'))
  assert.equal(loadSelfQaConfig(file).repo, 'acme/widget')
  assert.equal(loadSelfQaConfig(file).paneOrigins.pr, 'http://127.0.0.1:4102')
  writeFileSync(file, 'QA_REPO=acme/widget\n')
  assert.throws(() => loadSelfQaConfig(file), /GITHUB_QA_TOKEN missing/)
})

test('selfQaCommand runs demo mode straight from the checkout on the reserved port', () => {
  assert.deepEqual(selfQaCommand({ ref: '/wt/abc', port: 45678 }, '/usr/local/bin/node'), {
    cmd: '/usr/local/bin/node',
    args: ['demo/server.mjs'],
    cwd: '/wt/abc',
    env: { PORT: '45678' },
  })
})

test('the pane env is PORT, QA_DEMO_SPEED, the pane\'s own origin as QA_HARNESS_ORIGIN and the outer harness as QA_FRAME_ANCESTORS', () => {
  // the inner demo's harness is seen at the outer pane's origin, framed by
  // the outer harness: CSP checks every ancestor
  const { envTransform } = adapters({ harnessOrigin: 'http://127.0.0.1:3100' })
  assert.deepEqual(envTransform.derivePaneEnv({ prodEnv: { SECRET: 'x' }, pane }), {
    app: { PORT: '45678', QA_DEMO_SPEED: '1', QA_HARNESS_ORIGIN: 'http://127.0.0.1:3102', QA_FRAME_ANCESTORS: 'http://127.0.0.1:3100' },
  })
  // without an outer origin there is no QA_FRAME_ANCESTORS
  assert.deepEqual(adapters().envTransform.derivePaneEnv({ prodEnv: {}, pane }), {
    app: { PORT: '45678', QA_DEMO_SPEED: '1', QA_HARNESS_ORIGIN: 'http://127.0.0.1:3102' },
  })
  const slow = adapters({ speed: '0' })
  assert.equal(slow.envTransform.derivePaneEnv({ prodEnv: {}, pane }).app.QA_DEMO_SPEED, '0')
})

test('the outer harness origin may be a function, read each time a pane env is derived', () => {
  let origin = null
  const { envTransform } = adapters({ harnessOrigin: () => origin })
  assert.equal(envTransform.derivePaneEnv({ prodEnv: {}, pane }).app.QA_FRAME_ANCESTORS, undefined)
  origin = 'http://127.0.0.1:41234'
  assert.equal(envTransform.derivePaneEnv({ prodEnv: {}, pane }).app.QA_FRAME_ANCESTORS, 'http://127.0.0.1:41234')
})

// The inner demos' panes render only when they allow this harness as an
// ancestor. On QA_HARNESS_PORT=0 its origin is the bound port's, known once
// the harness listens, which is before any pane boots.
test('runSelfQa gives the pane env the outer harness origin, on a fixed port and on port 0', async () => {
  for (const [lines, want] of [
    [[], 'http://127.0.0.1:3100'],
    [['QA_HARNESS_PORT=4100'], 'http://127.0.0.1:4100'],
    [['QA_HARNESS_PORT=0'], 'http://127.0.0.1:45999'],
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'self-qa-env-'))
    const file = join(dir, '.env.qa')
    writeFileSync(file, ['GITHUB_QA_TOKEN=tok', ...lines].join('\n'))
    let listening = false
    const fake = { servers: { harness: { address: () => (listening ? { port: 45999 } : null) } }, shutdown: async () => {} }
    let started = null
    const conductor = await runSelfQa({
      env: { QA_ENV_FILE: file, XDG_CACHE_HOME: join(dir, 'cache') },
      proc: { on() {}, exit() {} },
      log: { log() {}, error() {} },
      start: opts => { started = opts; return fake },
    })
    assert.equal(conductor, fake)
    listening = true
    assert.equal(started.adapters.envTransform.derivePaneEnv({ prodEnv: {}, pane }).app.QA_FRAME_ANCESTORS, want, lines.join())
  }
})

test('auth lands on the pane origin; there is no database or seed', async () => {
  const a = adapters()
  assert.equal(a.auth.requiresDb, false)
  assert.deepEqual(await a.auth.establishSession({ pane, operator: null }), { landingUrl: 'http://127.0.0.1:3102/' })
  assert.deepEqual(a.seed.databases, [])
  await a.seed.seedPane({})
})

test('the build and provisioner are the built-in adapters, on-boot migration, no runMigrate', () => {
  const { build, provisioner } = adapters()
  assert.equal(build.migrationStrategy, 'on-boot')
  for (const m of ['ensureBuilt', 'resolvePrImages', 'resolveBaseImages', 'describePrs', 'subscribeBuild']) assert.equal(typeof build[m], 'function', m)
  for (const m of ['provisionDatabase', 'reserveServices', 'launchServices', 'waitHealthy', 'teardown', 'sweep', 'logs']) assert.equal(typeof provisioner[m], 'function', m)
  assert.equal(provisioner.runMigrate, undefined)
})

// On a tailnet layout self-QA dogfoods the tailscale Exposure adapter, so the
// conductor mounts itself; a loopback layout gets none and is unchanged.
test('selfQaExposure: the tailscale adapter only in tailscale mode', async () => {
  const runs = []
  let made = 0
  const makeExec = () => {
    made++
    return async (cmd, args, opts) => { runs.push([cmd, args, opts]); return { stdout: '{}' } }
  }
  assert.equal(selfQaExposure({ exposure: 'none', env: {} }, makeExec), undefined)
  assert.equal(made, 0, 'no exec function is made for none mode')

  const exposure = selfQaExposure({ exposure: 'tailscale', env: {} }, makeExec)
  assert.equal(made, 1)
  assert.deepEqual(await exposure.check([]), { ok: true, drift: [] })
  assert.deepEqual(runs, [['tailscale', ['serve', 'status', '--json'], { timeout: 30_000 }]])
  // QA_TAILSCALE_BIN picks the CLI (on macOS the one on PATH may be older
  // than the app's daemon)
  const app = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
  await selfQaExposure({ exposure: 'tailscale', env: { QA_TAILSCALE_BIN: app } }, makeExec).check([])
  assert.equal(runs[1][0], app)

  // runSelfQa passes it to the conductor
  const tailnet = [
    'QA_PUBLIC_HOST=box.ts.net', 'QA_BASE_ORIGIN=https://box.ts.net:8443', 'QA_PR_ORIGIN=https://box.ts.net:10000', 'QA_ALLOWED_LOGINS=alice@github',
  ]
  for (const [lines, wired, page] of [[[], false, 'http://127.0.0.1:3100/qa/'], [tailnet, true, 'https://box.ts.net:8444/qa/']]) {
    const dir = mkdtempSync(join(tmpdir(), 'self-qa-env-'))
    const file = join(dir, '.env.qa')
    writeFileSync(file, ['GITHUB_QA_TOKEN=tok', ...lines].join('\n'))
    let started = null
    const logged = []
    await runSelfQa({
      env: { QA_ENV_FILE: file, XDG_CACHE_HOME: join(dir, 'cache') },
      proc: { on() {}, exit() {} },
      log: { log: line => logged.push(line), error() {} },
      start: opts => { started = opts; return { servers: { harness: { address: () => null } }, shutdown: async () => {} } },
    })
    assert.equal(started.cfg.exposure, wired ? 'tailscale' : 'none')
    assert.equal('exposure' in started.adapters, wired, lines.join())
    if (wired) for (const m of ['ensure', 'check']) assert.equal(typeof started.adapters.exposure[m], 'function', m)
    // the page is under /qa/, the only path mounted on the harness port
    assert.ok(logged.some(l => l.startsWith(`[qa] open ${page} `)), logged.join('\n'))
  }
})

// --- removing the mounts on exit ---------------------------------------------
// A mount left behind publishes whatever listens on its loopback port next,
// with no identity gate: a loopback self-QA, say, which a tailnet peer then
// reaches by sending a loopback Host. So self-QA removes its mounts on exit.

const HOST = 'box.ts.net'
const MOUNTS = [
  { name: 'harness', host: HOST, port: 8444, path: '/qa', target: 'http://127.0.0.1:3100' },
  { name: 'base', host: HOST, port: 8443, path: '/', target: 'http://127.0.0.1:3101' },
  { name: 'pr', host: HOST, port: 10000, path: '/', target: 'http://127.0.0.1:3102' },
]
const OFF = [
  ['tailscale', 'serve', '--https=8444', '--set-path=/qa', 'off'],
  ['tailscale', 'serve', '--https=8443', 'off'],
  ['tailscale', 'serve', '--https=10000', 'off'],
]

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

// A fake tailscale CLI over an in-memory serve config, printed as `serve
// status --json` prints it (test/fixtures/tailscale): `serve --bg
// --https=P [--set-path=X] T` sets a handler and `serve --https=P
// [--set-path=X] off` removes it. Every call is recorded; `hold(args)` may
// return a promise the call waits for, and `fail(args)` makes it reject.
function fakeTailscale({ hold = () => null, fail = () => false } = {}) {
  const st = { TCP: { 8444: { HTTPS: true } }, Web: { [`${HOST}:8444`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3001' } } } } }
  const runs = []
  const exec = async (cmd, args, opts) => {
    runs.push([cmd, ...args])
    assert.deepEqual(opts, { timeout: 30_000 })
    await hold(args)
    if (fail(args)) throw new Error(`${cmd} ${args[0]}: Command failed: ${cmd} ${args.join(' ')}\nerror: it broke`)
    if (args.join(' ') === 'serve status --json') return { stdout: `${JSON.stringify(st, null, 2)}\n` }
    const port = args.find(a => a.startsWith('--https=')).slice('--https='.length)
    const path = args.find(a => a.startsWith('--set-path='))?.slice('--set-path='.length) ?? '/'
    const key = `${HOST}:${port}`
    if (args.at(-1) === 'off') {
      delete st.Web[key].Handlers[path]
      if (Object.keys(st.Web[key].Handlers).length === 0) { delete st.Web[key]; delete st.TCP[port] }
    } else {
      st.TCP[port] = { HTTPS: true }
      ;(st.Web[key] ??= { Handlers: {} }).Handlers[path] = { Proxy: args.at(-1) }
    }
    return { stdout: '' }
  }
  const offs = () => runs.filter(r => r.at(-1) === 'off')
  return { st, runs, exec, offs }
}

function recordingLog() {
  const lines = []
  return { lines, log: { log: line => lines.push(line), error: line => lines.push(`ERROR ${line}`) } }
}

const TAILSCALE = { exposure: 'tailscale', env: {} }

test('unmount removes the mounts the conductor declared, and only handlers that still proxy to self-QA', async () => {
  const ts = fakeTailscale()
  const exposure = selfQaExposure(TAILSCALE, () => ts.exec)
  assert.deepEqual((await exposure.ensure(MOUNTS)).added, MOUNTS)
  assert.equal((await exposure.check(MOUNTS)).ok, true)

  // the PR pane's port now points elsewhere, and a handler under /qa isn't
  // self-QA's either
  ts.st.Web[`${HOST}:10000`].Handlers['/'] = { Proxy: 'http://127.0.0.1:9' }
  ts.st.Web[`${HOST}:8444`].Handlers['/qa/admin'] = { Proxy: 'http://127.0.0.1:4000' }
  const { lines, log } = recordingLog()
  await exposure.unmount(log)
  assert.deepEqual(ts.offs(), OFF.slice(0, 2))
  assert.deepEqual(lines, ['[qa] exposure removed 8444/qa', '[qa] exposure removed 8443/'])
  assert.deepEqual(Object.keys(ts.st.Web).sort(), [`${HOST}:10000`, `${HOST}:8444`])
  assert.deepEqual(ts.st.Web[`${HOST}:8444`].Handlers, { '/': { Proxy: 'http://127.0.0.1:3001' }, '/qa/admin': { Proxy: 'http://127.0.0.1:4000' } }, 'the other handlers on 8444 stay')
  assert.deepEqual(ts.st.Web[`${HOST}:10000`].Handlers['/'], { Proxy: 'http://127.0.0.1:9' })

  // and nothing writes them back
  const runs = ts.runs.length
  await assert.rejects(exposure.ensure(MOUNTS), /self-QA is stopping/)
  assert.equal(ts.runs.length, runs)

  // with nothing declared, it runs nothing
  const idle = fakeTailscale()
  await selfQaExposure(TAILSCALE, () => idle.exec).unmount(log)
  assert.deepEqual(idle.runs, [])
})

test('unmount waits for an ensure in flight, so a pass can\'t write a mount back after it', async () => {
  const release = deferred()
  const ts = fakeTailscale({ hold: args => (args.includes('--https=10000') && args.at(-1) !== 'off' ? release.promise : null) })
  const exposure = selfQaExposure({ exposure: 'tailscale', env: { QA_TAILSCALE_BIN: 'ts' } }, () => ts.exec)
  const pass = exposure.ensure(MOUNTS)
  await new Promise(r => setTimeout(r, 10))
  const removing = exposure.unmount(recordingLog().log)
  await new Promise(r => setTimeout(r, 10))
  assert.deepEqual(ts.offs(), [], 'nothing is removed while ensure runs')
  release.resolve()
  await pass
  await removing
  assert.deepEqual(ts.offs(), OFF.map(([, ...args]) => ['ts', ...args]))
  assert.deepEqual(ts.st, { TCP: { 8444: { HTTPS: true } }, Web: { [`${HOST}:8444`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3001' } } } } })
})

test('unmount logs what it can\'t remove, with the command to run, and goes on', async () => {
  const ts = fakeTailscale({ fail: args => args.join(' ') === 'serve --https=8443 off' })
  const exposure = selfQaExposure(TAILSCALE, () => ts.exec)
  await exposure.ensure(MOUNTS)
  const { lines, log } = recordingLog()
  await exposure.unmount(log)
  assert.deepEqual(ts.offs(), OFF)
  assert.deepEqual(lines, [
    '[qa] exposure removed 8444/qa',
    'ERROR [qa] could not remove the 8443/ mount: tailscale serve: Command failed: tailscale serve --https=8443 off error: it broke; remove it yourself: tailscale serve --https=8443 off',
    '[qa] exposure removed 10000/',
  ])

  // no status, no removal: each command is logged
  let down = false
  const st = fakeTailscale({ fail: args => down && args.includes('status') })
  const unread = selfQaExposure(TAILSCALE, () => st.exec)
  await unread.ensure(MOUNTS)
  down = true
  const r = recordingLog()
  await unread.unmount(r.log)
  assert.deepEqual(st.offs(), [])
  assert.deepEqual(r.lines, [
    'ERROR [qa] could not read tailscale serve status to remove self-QA\'s mounts: tailscale serve: Command failed: tailscale serve status --json error: it broke',
    ...OFF.map(argv => `ERROR [qa] remove it yourself: ${argv.join(' ')}`),
  ])
})

test('on a signal, runSelfQa shuts the conductor down, then removes the mounts, then exits', async () => {
  const tailnet = ['QA_PUBLIC_HOST=box.ts.net', 'QA_BASE_ORIGIN=https://box.ts.net:8443', 'QA_PR_ORIGIN=https://box.ts.net:10000', 'QA_ALLOWED_LOGINS=alice@github']
  for (const [lines, shutdownFails, wantExit] of [[tailnet, false, 0], [tailnet, true, 1], [[], false, 0]]) {
    const dir = mkdtempSync(join(tmpdir(), 'self-qa-env-'))
    const file = join(dir, '.env.qa')
    writeFileSync(file, ['GITHUB_QA_TOKEN=tok', ...lines].join('\n'))
    const ts = fakeTailscale()
    const order = []
    const handlers = {}
    const exited = deferred()
    let started = null
    const logged = []
    await runSelfQa({
      env: { QA_ENV_FILE: file, XDG_CACHE_HOME: join(dir, 'cache') },
      proc: { on: (signal, fn) => { handlers[signal] = fn }, exit: code => { order.push(`exit ${code}`); exited.resolve() } },
      log: { log: line => logged.push(line), error: line => logged.push(`ERROR ${line}`) },
      makeExec: () => async (cmd, args, opts) => {
        if (args.at(-1) === 'off') order.push(args.join(' '))
        return ts.exec(cmd, args, opts)
      },
      start: opts => {
        started = opts
        return {
          servers: { harness: { address: () => null } },
          shutdown: async () => {
            order.push('shutdown')
            if (shutdownFails) throw new Error('teardown broke')
          },
        }
      },
    })
    assert.deepEqual(Object.keys(handlers).sort(), ['SIGHUP', 'SIGINT', 'SIGTERM'])
    // the conductor's first pass
    if (started.adapters.exposure) await started.adapters.exposure.ensure(MOUNTS)
    handlers.SIGINT('SIGINT')
    await exited.promise
    const removed = lines.length ? OFF.map(([, ...args]) => args.join(' ')) : []
    assert.deepEqual(order, ['shutdown', ...removed, `exit ${wantExit}`], lines.join())
    if (shutdownFails) assert.ok(logged.includes('ERROR [qa] shutdown failed: teardown broke'), logged.join('\n'))
    if (lines.length) assert.ok(logged.some(l => l.endsWith('(Ctrl-C to stop; panes are torn down and the tailscale serve mounts removed on exit)')), logged.join('\n'))
  }
})

test('runSelfQa refuses to start without its env file, naming what to put in it', async () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'self-qa-env-')), '.env.qa')
  await assert.rejects(() => runSelfQa({ env: { QA_ENV_FILE: missing }, proc: { on() {}, exit() {} }, log: { log() {}, error() {} } }), /GITHUB_QA_TOKEN/)
})
