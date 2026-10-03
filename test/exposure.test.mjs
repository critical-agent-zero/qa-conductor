// The Exposure seam's pure core: the mounts a cfg declares, and one
// reconcile pass over an adapter. No tailscale here: the adapter is a fake.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mountsFor, reconcileExposure } from '../lib/exposure.mjs'
import { portOf } from '../lib/net.mjs'

const HOST = 'qa-box.tail1234.ts.net'
const cfg = {
  ports: { harness: 3100, base: 3101, pr: 3102 },
  harnessOrigin: `https://${HOST}:8444`,
  paneOrigins: { base: `https://${HOST}:8443`, pr: `https://${HOST}:10000` },
}

test('mountsFor: the harness under /qa at its origin\'s port, each pane at / at its origin\'s port, targets on cfg.host', () => {
  const expected = bind => [
    { name: 'harness', host: HOST, port: 8444, path: '/qa', target: `http://${bind}:3100` },
    { name: 'base', host: HOST, port: 8443, path: '/', target: `http://${bind}:3101` },
    { name: 'pr', host: HOST, port: 10000, path: '/', target: `http://${bind}:3102` },
  ]
  // no cfg.host: the conductor's default bind
  assert.deepEqual(mountsFor(cfg), expected('127.0.0.1'))
  assert.deepEqual(mountsFor({ ...cfg, host: '127.0.0.1' }), expected('127.0.0.1'))
  assert.deepEqual(mountsFor({ ...cfg, host: 'localhost' }), expected('localhost'))
})

test('each mount\'s host is its public origin\'s hostname, not cfg.host', () => {
  const mounts = mountsFor({
    ...cfg,
    host: '127.0.0.2',
    harnessOrigin: 'https://Harness.tail1234.ts.net:8445/qa/',
    paneOrigins: { base: 'https://base.tail1234.ts.net:8443', pr: 'https://pr.tail1234.ts.net:10000' },
  })
  assert.deepEqual(mounts.map(m => [m.name, m.host, m.port]), [
    ['harness', 'harness.tail1234.ts.net', 8445],
    ['base', 'base.tail1234.ts.net', 8443],
    ['pr', 'pr.tail1234.ts.net', 10000],
  ])
  // the harness origin's path is dropped: the mount path is always /qa
  assert.equal(mounts[0].path, '/qa')
  assert.ok(mounts.every(m => m.target.startsWith('http://127.0.0.2:')))
})

test('a port-less https origin means 443', () => {
  assert.equal(portOf('https://box.ts.net'), 443)
  assert.equal(portOf('https://box.ts.net:443'), 443)
  assert.equal(portOf('https://box.ts.net:8443'), 8443)
  assert.equal(portOf('http://127.0.0.1'), 80)
  assert.throws(() => portOf('ftp://box.ts.net'), /http\(s\) origin/)
  const mounts = mountsFor({ ...cfg, paneOrigins: { ...cfg.paneOrigins, base: `https://${HOST}` } })
  assert.equal(mounts[1].port, 443)
})

test('explicit ports (the bound ports) override cfg.ports', () => {
  const mounts = mountsFor({ ...cfg, ports: { harness: 0, base: 0, pr: 0 } }, { ports: { harness: 41000, base: 41001, pr: 41002 } })
  assert.deepEqual(mounts.map(m => m.target), ['http://127.0.0.1:41000', 'http://127.0.0.1:41001', 'http://127.0.0.1:41002'])
  // the public side still comes from the origins
  assert.deepEqual(mounts.map(m => m.port), [8444, 8443, 10000])
})

test("cfg.host '::1' targets http://[::1]:<port>", () => {
  assert.deepEqual(mountsFor({ ...cfg, host: '::1' }).map(m => m.target), ['http://[::1]:3100', 'http://[::1]:3101', 'http://[::1]:3102'])
})

test('mountsFor refuses an http origin, a missing or unparseable pane origin, two mounts on one port, a missing harness origin and listen port 0', () => {
  const refuses = (overrides, pattern, opts) => assert.throws(() => mountsFor({ ...cfg, ...overrides }, opts), pattern, JSON.stringify(overrides))
  // tailscale serve publishes https only
  refuses({ harnessOrigin: 'http://127.0.0.1:3100' }, /harness origin \(QA_HARNESS_ORIGIN\) http:\/\/127\.0\.0\.1:3100 is not https/)
  refuses({ paneOrigins: { ...cfg.paneOrigins, pr: 'http://localhost:3102' } }, /QA_PR_ORIGIN.*not https/)
  // missing or unparseable pane origins
  refuses({ paneOrigins: { pr: cfg.paneOrigins.pr } }, /base pane origin \(QA_BASE_ORIGIN\) is missing/)
  refuses({ paneOrigins: undefined }, /QA_BASE_ORIGIN\) is missing/)
  refuses({ paneOrigins: { ...cfg.paneOrigins, pr: 'not a url' } }, /QA_PR_ORIGIN\) must be an origin/)
  refuses({ paneOrigins: { ...cfg.paneOrigins, base: 'file:///etc/passwd' } }, /QA_BASE_ORIGIN\) must be an origin/)
  // two mounts on one port, on one hostname or two
  refuses({ paneOrigins: { base: 'https://a.ts.net:8443', pr: 'https://b.ts.net:8443' } }, /base and pr mounts are both on port 8443/)
  refuses({ harnessOrigin: `https://${HOST}:10000` }, /harness and pr mounts are both on port 10000/)
  refuses({ harnessOrigin: `https://${HOST}`, paneOrigins: { ...cfg.paneOrigins, base: 'https://other.ts.net:443' } }, /both on port 443/)
  // no harness origin
  for (const harnessOrigin of [null, undefined, '']) refuses({ harnessOrigin }, /no harness origin to mount \(set QA_HARNESS_ORIGIN\)/)
  // listen ports: the bound ones, never 0
  refuses({ ports: { ...cfg.ports, harness: 0 } }, /harness listen port must be an integer from 1 to 65535, got 0/)
  for (const bad of [-1, 1.5, 65536, '3101', NaN, undefined]) {
    refuses({}, /base listen port must be an integer from 1 to 65535/, { ports: { harness: 3100, base: bad, pr: 3102 } })
  }
})

// A fake adapter that records which members ran and with what mounts.
function fakeExposure({ drift = [], added = [], ensureFails = null, checkFails = null } = {}) {
  return {
    calls: [],
    async ensure(mounts) {
      this.calls.push(['ensure', mounts])
      if (ensureFails !== null) throw ensureFails
      return { added, ok: mounts.filter(m => !added.includes(m)) }
    },
    async check(mounts) {
      this.calls.push(['check', mounts])
      if (checkFails !== null) throw checkFails
      return { ok: drift.length === 0, drift }
    },
  }
}

test('reconcileExposure: ensure then check, reporting what was added', async () => {
  const mounts = mountsFor(cfg)
  const exposure = fakeExposure({ added: [mounts[0]] })
  const r = await reconcileExposure(exposure, mounts, { now: () => 7 })
  assert.deepEqual(exposure.calls, [['ensure', mounts], ['check', mounts]])
  assert.deepEqual(r, { ok: true, checkedAt: 7, drift: [], added: [mounts[0]], error: null })

  // drift that remains after ensure is reported, and is not ok
  const drift = [{ mount: mounts[2], actual: null }]
  const left = await reconcileExposure(fakeExposure({ drift, added: [mounts[2]] }), mounts, { now: () => 8 })
  assert.deepEqual(left, { ok: false, checkedAt: 8, drift, added: [mounts[2]], error: null })

  // ok only when the check says ok and nothing drifted
  for (const checked of [{ ok: true, drift }, { ok: 'yes', drift: [] }, { drift: [] }]) {
    const exposure = { ensure: async () => ({ added: [], ok: mounts }), check: async () => checked }
    assert.equal((await reconcileExposure(exposure, mounts)).ok, false, JSON.stringify(checked))
  }
})

test('checkOnly never ensures', async () => {
  const mounts = mountsFor(cfg)
  const drift = [{ mount: mounts[1], actual: 'http://127.0.0.1:9' }]
  const exposure = fakeExposure({ drift })
  const r = await reconcileExposure(exposure, mounts, { checkOnly: true, now: () => 3 })
  assert.deepEqual(exposure.calls.map(([member]) => member), ['check'])
  assert.deepEqual(r, { ok: false, checkedAt: 3, drift, added: [], error: null })
})

test('never rejects: an adapter error becomes { ok: false, error }', async () => {
  const mounts = mountsFor(cfg)
  const failed = (error, added = []) => ({ ok: false, checkedAt: 1, drift: [], added, error })
  const run = (exposure, opts = {}) => reconcileExposure(exposure, mounts, { now: () => 1, ...opts })

  const both = new Error('tailscale: not found')
  assert.deepEqual(await run(fakeExposure({ ensureFails: both, checkFails: both })), failed('tailscale: not found'))
  // a failed ensure skips the check
  const exposure = fakeExposure({ ensureFails: new Error('serve: exit 1') })
  assert.deepEqual(await run(exposure), failed('serve: exit 1'))
  assert.deepEqual(exposure.calls.map(([member]) => member), ['ensure'])
  // a check that fails after ensure added mounts still reports them
  assert.deepEqual(await run(fakeExposure({ added: [mounts[0]], checkFails: new Error('status: timeout') })), failed('status: timeout', [mounts[0]]))
  assert.deepEqual(await run(fakeExposure({ checkFails: new Error('status: timeout') }), { checkOnly: true }), failed('status: timeout'))
  // an ensure that fails part way says what it added on its error
  const partial = Object.assign(new Error('could not mount 8443/'), { added: [mounts[0]] })
  assert.deepEqual(await run(fakeExposure({ ensureFails: partial })), failed('could not mount 8443/', [mounts[0]]))
  const bogus = Object.assign(new Error('status: timeout'), { added: 'not a list' })
  assert.deepEqual(await run(fakeExposure({ added: [mounts[1]], checkFails: bogus })), failed('status: timeout', [mounts[1]]))
  // whatever is thrown, and whatever the adapter is
  assert.deepEqual(await run(fakeExposure({ ensureFails: 'a string' })), failed('a string'))
  assert.equal((await run(null)).ok, false)
  assert.match((await run(null)).error, /ensure/)
  assert.match((await run({ ensure: async () => ({ added: [] }), check: async () => undefined })).error, /check/)
  assert.equal((await run({ ensure: () => { throw new Error('sync') }, check: async () => ({ ok: true, drift: [] }) })).error, 'sync')
})
