import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SELF_REPO, cacheDirFor, runSelfQa, selfQaAdapters, selfQaCommand } from '../qa/self.mjs'

const github = { prInfo: async () => ({}), authorPermission: async () => 'write' }
const pane = { publicOrigin: 'http://127.0.0.1:3102', services: { app: { url: 'http://127.0.0.1:45678', port: 45678 } } }

function adapters(overrides = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'self-qa-'))
  return selfQaAdapters({ repo: SELF_REPO, github, cacheDir, execPath: '/usr/local/bin/node', ...overrides })
}

test('cacheDirFor: per repo under XDG_CACHE_HOME, else ~/.cache', () => {
  assert.equal(cacheDirFor('critical-labs/qa-conductor', { XDG_CACHE_HOME: '/x/cache' }, '/home/u'), '/x/cache/qa-conductor/critical-labs-qa-conductor')
  assert.equal(cacheDirFor('critical-labs/qa-conductor', {}, '/home/u'), '/home/u/.cache/qa-conductor/critical-labs-qa-conductor')
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

test('runSelfQa refuses to start without its env file, naming what to put in it', async () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'self-qa-env-')), '.env.qa')
  await assert.rejects(() => runSelfQa({ env: { QA_ENV_FILE: missing }, proc: { on() {}, exit() {} }, log: { log() {}, error() {} } }), /GITHUB_QA_TOKEN/)
})
