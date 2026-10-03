// The expose CLI: runExpose, its exit codes and what it prints, against a fake
// adapter. No tailscale here.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runExpose } from '../lib/exposure.mjs'

const HOST = 'h.ts.net'
const CFG = {
  exposure: 'tailscale',
  ports: { harness: 3100, base: 3101, pr: 3102 },
  harnessOrigin: `https://${HOST}:8444`,
  paneOrigins: { base: `https://${HOST}:8443`, pr: `https://${HOST}:10000` },
}
const MOUNTS = [
  { name: 'harness', host: HOST, port: 8444, path: '/qa', target: 'http://127.0.0.1:3100' },
  { name: 'base', host: HOST, port: 8443, path: '/', target: 'http://127.0.0.1:3101' },
  { name: 'pr', host: HOST, port: 10000, path: '/', target: 'http://127.0.0.1:3102' },
]

// Records what was printed, and on which stream.
function recordLog() {
  const lines = []
  return { lines, log: { log: line => lines.push(['out', line]), error: line => lines.push(['err', line]) } }
}

// A fake adapter that records its calls. `drift` is what check reports.
function fakeExposure({ drift = [], added = [], ensureFails = null } = {}) {
  const calls = []
  return {
    calls,
    async ensure(mounts) {
      calls.push(['ensure', mounts])
      if (ensureFails !== null) throw ensureFails
      return { added, ok: mounts.filter(m => !added.includes(m)) }
    },
    async check(mounts) {
      calls.push(['check', mounts])
      return { ok: drift.length === 0, drift }
    },
  }
}

test('none: 0, no adapter calls', async () => {
  const exposure = fakeExposure()
  const { lines, log } = recordLog()
  assert.equal(await runExpose({ cfg: { ...CFG, exposure: 'none' }, exposure, log }), 0)
  assert.equal(await runExpose({ cfg: { ...CFG, exposure: 'none' }, exposure, checkOnly: true, log }), 0)
  assert.deepEqual(exposure.calls, [])
  assert.deepEqual(lines, [['out', 'qa exposure: QA_EXPOSURE=none, nothing to do'], ['out', 'qa exposure: QA_EXPOSURE=none, nothing to do']])
})

test('check-only with drift: 1, no ensure', async () => {
  const drift = [{ mount: MOUNTS[1], actual: null }, { mount: MOUNTS[2], actual: 'http://127.0.0.1:9' }]
  const exposure = fakeExposure({ drift })
  const { lines, log } = recordLog()
  assert.equal(await runExpose({ cfg: CFG, exposure, checkOnly: true, log }), 1)
  assert.deepEqual(exposure.calls, [['check', MOUNTS]])
  assert.deepEqual(lines, [
    ['err', 'qa exposure: drift 8443/: want http://127.0.0.1:3101, have nothing'],
    ['err', 'qa exposure: drift 10000/: want http://127.0.0.1:3102, have http://127.0.0.1:9'],
  ])
})

test('ensured and clean: 0, mounted lines printed', async () => {
  const exposure = fakeExposure({ added: [MOUNTS[0], MOUNTS[2]] })
  const { lines, log } = recordLog()
  assert.equal(await runExpose({ cfg: CFG, exposure, log }), 0)
  assert.deepEqual(exposure.calls, [['ensure', MOUNTS], ['check', MOUNTS]])
  assert.deepEqual(lines, [
    ['out', 'qa exposure: mounted 8444/qa -> http://127.0.0.1:3100'],
    ['out', 'qa exposure: mounted 10000/ -> http://127.0.0.1:3102'],
    ['out', `qa exposure: ok (harness https://${HOST}:8444/qa/)`],
  ])

  // nothing to add: only the ok line
  const quiet = recordLog()
  assert.equal(await runExpose({ cfg: CFG, exposure: fakeExposure(), log: quiet.log }), 0)
  assert.deepEqual(quiet.lines, [['out', `qa exposure: ok (harness https://${HOST}:8444/qa/)`]])
})

test('adapter error: 1', async () => {
  const { lines, log } = recordLog()
  const failing = fakeExposure({ ensureFails: new Error('tailscale serve: exit status 1') })
  assert.equal(await runExpose({ cfg: CFG, exposure: failing, log }), 1)
  assert.deepEqual(lines, [['err', 'qa exposure: tailscale serve: exit status 1']])

  // a pass that wrote some mounts before it failed says which
  const partial = recordLog()
  const err = Object.assign(new Error('could not mount 8443/ -> http://127.0.0.1:3101: busy'), { added: [MOUNTS[0]] })
  assert.equal(await runExpose({ cfg: CFG, exposure: fakeExposure({ ensureFails: err }), log: partial.log }), 1)
  assert.deepEqual(partial.lines, [
    ['out', 'qa exposure: mounted 8444/qa -> http://127.0.0.1:3100'],
    ['err', 'qa exposure: could not mount 8443/ -> http://127.0.0.1:3101: busy'],
  ])

  // no adapter at all, or one that throws something that isn't an Error
  assert.equal(await runExpose({ cfg: CFG, exposure: undefined, log: recordLog().log }), 1)
  assert.equal(await runExpose({ cfg: CFG, exposure: fakeExposure({ ensureFails: Object.create(null) }), log: recordLog().log }), 1)
})

test('mount layout error: 2', async () => {
  const layouts = [
    [{ paneOrigins: { ...CFG.paneOrigins, pr: 'http://127.0.0.1:3102' } }, /^qa exposure: the PR pane origin \(QA_PR_ORIGIN\) http:\/\/127\.0\.0\.1:3102 is not https/],
    [{ ports: { ...CFG.ports, harness: 0 } }, /^qa exposure: the harness listen port must be an integer from 1 to 65535, got 0/],
    [{ paneOrigins: { base: `https://${HOST}:8443`, pr: `https://${HOST}:8443` } }, /both on port 8443/],
    [{ paneOrigins: { base: CFG.paneOrigins.base } }, /QA_PR_ORIGIN\) is missing/],
  ]
  for (const [overrides, message] of layouts) {
    const exposure = fakeExposure()
    const { lines, log } = recordLog()
    assert.equal(await runExpose({ cfg: { ...CFG, ...overrides }, exposure, log }), 2, JSON.stringify(overrides))
    assert.deepEqual(exposure.calls, [], 'no adapter call')
    assert.equal(lines.length, 1)
    assert.equal(lines[0][0], 'err')
    assert.match(lines[0][1], message)
  }
})

test('a cfg without exposure or harnessOrigin resolves both as the conductor does; an unknown mode is a config error', async () => {
  // no exposure: the ts.net origins make it tailscale; no harnessOrigin: :8444 on the public host
  const { exposure: _mode, harnessOrigin: _origin, ...bare } = CFG
  const exposure = fakeExposure()
  const { lines, log } = recordLog()
  assert.equal(await runExpose({ cfg: { ...bare, publicHost: HOST }, exposure, log }), 0)
  assert.deepEqual(exposure.calls.map(([member, mounts]) => [member, mounts[0].port, mounts[0].path]), [['ensure', 8444, '/qa'], ['check', 8444, '/qa']])
  assert.deepEqual(lines, [['out', `qa exposure: ok (harness https://${HOST}:8444/qa/)`]])

  // all loopback: none
  const local = fakeExposure()
  const loopback = { ports: CFG.ports, paneOrigins: { base: 'http://127.0.0.1:3101', pr: 'http://127.0.0.1:3102' } }
  assert.equal(await runExpose({ cfg: loopback, exposure: local, log: recordLog().log }), 0)
  assert.deepEqual(local.calls, [])

  const odd = recordLog()
  assert.equal(await runExpose({ cfg: { ...CFG, exposure: 'caddy' }, exposure, log: odd.log }), 2)
  assert.deepEqual(odd.lines, [['err', 'qa exposure: QA_EXPOSURE must be none or tailscale, got "caddy"']])
  // a public host no origin can be derived from
  const bad = recordLog()
  assert.equal(await runExpose({ cfg: { ...bare, publicHost: 'a b' }, exposure, log: bad.log }), 2)
  assert.match(bad.lines[0][1], /^qa exposure: the harness origin derived from QA_PUBLIC_HOST must be an origin/)
})

test('a handler that takes some of a mount\'s requests is named as such, and an adapter that reports no mount still fails', async () => {
  const drift = [{ mount: MOUNTS[0], actual: '/qa/ -> http://127.0.0.1:9' }, { mount: MOUNTS[0], actual: '/qa/api (not a proxy)' }]
  const { lines, log } = recordLog()
  assert.equal(await runExpose({ cfg: CFG, exposure: fakeExposure({ drift }), checkOnly: true, log }), 1)
  assert.deepEqual(lines, [
    ['err', 'qa exposure: drift 8444/qa: the handler at /qa/ -> http://127.0.0.1:9 takes some of its requests; remove it'],
    ['err', 'qa exposure: drift 8444/qa: the handler at /qa/api (not a proxy) takes some of its requests; remove it'],
  ])

  // not ok, and no drift or error to show for it
  const vague = recordLog()
  const exposure = { ensure: async () => ({ added: [], ok: [] }), check: async () => ({ ok: false, drift: [] }) }
  assert.equal(await runExpose({ cfg: CFG, exposure, log: vague.log }), 1)
  assert.deepEqual(vague.lines, [['err', 'qa exposure: the adapter reported drift but named no mount']])

  // mount fields that aren't strings or integer ports
  const garbled = recordLog()
  const odd = { port: { toString() { throw new Error('no') } }, path: null, target: new URL('http://127.0.0.1:3100') }
  const weird = { ensure: async () => ({ added: [odd], ok: [] }), check: async () => ({ ok: false, drift: [{ mount: odd, actual: 42 }] }) }
  assert.equal(await runExpose({ cfg: CFG, exposure: weird, log: garbled.log }), 1)
  assert.deepEqual(garbled.lines, [['out', 'qa exposure: mounted ?? -> ?'], ['err', 'qa exposure: drift ??: want ?, have nothing']])

  // getters that throw: 1, not a rejection
  const sly = { get port() { throw new Error('no') } }
  const trap = recordLog()
  const traps = { ensure: async () => ({ added: [sly], ok: [] }), check: async () => ({ ok: false, drift: [{ get mount() { throw new Error('no') } }] }) }
  assert.equal(await runExpose({ cfg: CFG, exposure: traps, log: trap.log }), 1)
  assert.deepEqual(trap.lines.at(-1), ['err', 'qa exposure: the adapter returned a result that cannot be printed'])
})
