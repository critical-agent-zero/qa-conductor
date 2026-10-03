// The tailscale serve Exposure adapter, against `tailscale serve status
// --json` output and a recording execFileFn: no tailscaled, and no command is
// ever run for real.
//
// The fixtures in test/fixtures/tailscale/ are that command's stdout, in the
// shape and format tailscaled 1.98.5 prints: { TCP: { "<port>": { HTTPS:
// true } }, Web: { "<dnsname>:<port>": { Handlers: { "<path>": { Proxy:
// "<url>" } } } } }, two-space indented, keys sorted as strings, a trailing
// newline. serve-status-empty.json is the 1.98.5 CLI's output with no serve
// config. The rest are written to that shape, with a placeholder hostname;
// each has the RC app's handler at 8444 /, which the conductor doesn't
// declare and must never touch.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createTailscaleExposure } from '../lib/adapters/exposure-tailscale.mjs'
import { reconcileExposure } from '../lib/exposure.mjs'

const HOST = 'qa-box.tail1234.ts.net'
const fixture = name => readFileSync(new URL(`./fixtures/tailscale/serve-status-${name}.json`, import.meta.url), 'utf8')
// A fixture changed in place, printed back as the CLI would.
const edited = (name, edit) => {
  const st = JSON.parse(fixture(name))
  return `${JSON.stringify(edit(st) ?? st, null, 2)}\n`
}

const MOUNTS = [
  { name: 'harness', host: HOST, port: 8444, path: '/qa', target: 'http://127.0.0.1:3100' },
  { name: 'base', host: HOST, port: 8443, path: '/', target: 'http://127.0.0.1:3101' },
  { name: 'pr', host: HOST, port: 10000, path: '/', target: 'http://127.0.0.1:3102' },
]
const STATUS = ['tailscale', 'serve', 'status', '--json']

// Recording execFileFn: answers `serve status --json` with `status` (the
// CLI's stdout), records every call with its options, and applies nothing,
// so tests assert on the commands. A call for which `fail(args)` is true
// rejects the way makeExecFileFn does.
function recorder(status, { fail = () => false } = {}) {
  const calls = []
  const execFileFn = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    const sub = args.filter(a => !a.startsWith('--socket='))
    if (fail(sub)) throw Object.assign(new Error(`${cmd} ${args[0]}: Command failed: ${cmd} ${args.join(' ')}\nexit status 1`), { code: 1 })
    return { stdout: sub.join(' ') === 'serve status --json' ? status : '' }
  }
  const argv = () => calls.map(c => [c.cmd, ...c.args])
  return { calls, execFileFn, argv, writes: () => argv().filter(a => !a.includes('status')) }
}
const driftOf = r => r.drift.map(d => [d.mount.name, d.actual])
const check = (status, mounts = MOUNTS) => createTailscaleExposure({ execFileFn: recorder(status).execFileFn }).check(mounts)

test('check: all mounts present is ok', async () => {
  const { execFileFn, argv } = recorder(fixture('all'))
  assert.deepEqual(await createTailscaleExposure({ execFileFn }).check(MOUNTS), { ok: true, drift: [] })
  assert.deepEqual(argv(), [STATUS])
})

test('check: a missing handler and an empty config are drift with actual null', async () => {
  const r = await check(fixture('foreign-only'))
  assert.equal(r.ok, false)
  assert.deepEqual(driftOf(r), [['harness', null], ['base', null], ['pr', null]])
  assert.equal(r.drift[0].mount, MOUNTS[0], 'drift carries the mount itself')
  // one handler missing, its port still on https
  const one = edited('all', st => { delete st.Web[`${HOST}:8443`] })
  assert.deepEqual(driftOf(await check(one)), [['base', null]])
  // a missing path on a port that has others
  const noQa = edited('all', st => { delete st.Web[`${HOST}:8444`].Handlers['/qa'] })
  assert.deepEqual(driftOf(await check(noQa)), [['harness', null]])
  // no serve config: the CLI's `{}`, empty output, and `null`
  for (const stdout of [fixture('empty'), '', '\n', 'null\n']) {
    assert.deepEqual(driftOf(await check(stdout)), [['harness', null], ['base', null], ['pr', null]], JSON.stringify(stdout))
  }
})

test('check: a handler pointing elsewhere is drift with its actual target', async () => {
  const r = await check(fixture('wrong-target'))
  assert.equal(r.ok, false)
  assert.deepEqual(driftOf(r), [['pr', 'http://127.0.0.1:9']])
})

test('check: a handler on a port without HTTPS is drift', async () => {
  // served over plain http
  assert.deepEqual(driftOf(await check(fixture('no-https'))), [['base', null]])
  // the port missing from TCP, or HTTPS anything but true
  const noTcp = edited('all', st => { delete st.TCP['8443'] })
  assert.deepEqual(driftOf(await check(noTcp)), [['base', null]])
  for (const HTTPS of [false, 'true', 1]) {
    assert.deepEqual(driftOf(await check(edited('all', st => { st.TCP['8443'] = { HTTPS } }))), [['base', null]], String(HTTPS))
  }
})

test('ensure: mounts only what drifted, --set-path only for non-root, never touches foreign handlers', async () => {
  const { execFileFn, argv, writes } = recorder(fixture('foreign-only'))
  const r = await createTailscaleExposure({ execFileFn }).ensure(MOUNTS)
  assert.deepEqual(argv()[0], STATUS)
  assert.deepEqual(writes(), [
    ['tailscale', 'serve', '--bg', '--https=8444', '--set-path=/qa', 'http://127.0.0.1:3100'],
    ['tailscale', 'serve', '--bg', '--https=8443', 'http://127.0.0.1:3101'],
    ['tailscale', 'serve', '--bg', '--https=10000', 'http://127.0.0.1:3102'],
  ])
  assert.ok(!argv().some(a => a.includes('reset') || a.includes('off')), 'never reset or off')
  // the RC app's 8444 / is not declared: every write on 8444 is the /qa mount
  assert.ok(writes().filter(a => a.includes('--https=8444')).every(a => a.includes('--set-path=/qa')))
  assert.deepEqual(r, { added: MOUNTS, ok: [] })

  // a wrong target: only that mount is written
  const wrong = recorder(fixture('wrong-target'))
  const fixed = await createTailscaleExposure({ execFileFn: wrong.execFileFn }).ensure(MOUNTS)
  assert.deepEqual(wrong.writes(), [['tailscale', 'serve', '--bg', '--https=10000', 'http://127.0.0.1:3102']])
  assert.deepEqual(fixed, { added: [MOUNTS[2]], ok: [MOUNTS[0], MOUNTS[1]] })
})

test('ensure: nothing to do when every mount is present', async () => {
  const { execFileFn, argv } = recorder(fixture('all'))
  const r = await createTailscaleExposure({ execFileFn }).ensure(MOUNTS)
  assert.deepEqual(argv(), [STATUS])
  assert.deepEqual(r, { added: [], ok: MOUNTS })
})

test('a stale handler the conductor no longer declares is never touched', async () => {
  // The harness moved from 8444 to 8445: its old 8444 /qa handler stays, as
  // does the RC app's 8444 /. Only the operator removes either.
  const moved = [{ ...MOUNTS[0], port: 8445 }, MOUNTS[1], MOUNTS[2]]
  const { execFileFn, argv, writes } = recorder(fixture('all'))
  const exposure = createTailscaleExposure({ execFileFn })
  assert.deepEqual(driftOf(await exposure.check(moved)), [['harness', null]])
  await exposure.ensure(moved)
  assert.deepEqual(writes(), [['tailscale', 'serve', '--bg', '--https=8445', '--set-path=/qa', 'http://127.0.0.1:3100']])
  assert.ok(!argv().some(a => a.some(arg => arg.includes('8444'))))
})

test('ensure converges on a daemon that applies serve --bg, leaving the foreign handler as it was', async () => {
  // A stand-in tailscaled that applies `serve --bg --https=P [--set-path=X] T`
  // as 1.98.5 does: it sets X (default /) on P and keeps P's other paths.
  const state = JSON.parse(fixture('foreign-only'))
  const rc = structuredClone(state.Web[`${HOST}:8444`].Handlers['/'])
  const calls = []
  const execFileFn = async (cmd, args) => {
    calls.push(args.join(' '))
    if (args.join(' ') === 'serve status --json') return { stdout: `${JSON.stringify(state, null, 2)}\n` }
    const [, bg, https, ...rest] = args
    assert.equal(bg, '--bg')
    const port = https.replace('--https=', '')
    const path = rest.length === 2 ? rest[0].replace('--set-path=', '') : '/'
    state.TCP[port] = { HTTPS: true }
    state.Web[`${HOST}:${port}`] ??= { Handlers: {} }
    state.Web[`${HOST}:${port}`].Handlers[path] = { Proxy: rest.at(-1) }
    return { stdout: '' }
  }
  const exposure = createTailscaleExposure({ execFileFn })
  const r = await reconcileExposure(exposure, MOUNTS, { now: () => 1 })
  assert.deepEqual(r, { ok: true, checkedAt: 1, drift: [], added: MOUNTS, error: null })
  assert.deepEqual(state.Web[`${HOST}:8444`].Handlers['/'], rc)
  // a second pass finds nothing to do
  calls.length = 0
  assert.deepEqual(await exposure.ensure(MOUNTS), { added: [], ok: MOUNTS })
  assert.deepEqual(calls, ['serve status --json'])
})

test('a CLI failure rejects (the conductor turns it into an error result)', async () => {
  // tailscaled down: status fails, and nothing is written
  const down = recorder(fixture('all'), { fail: args => args.includes('status') })
  const exposure = createTailscaleExposure({ execFileFn: down.execFileFn })
  await assert.rejects(exposure.check(MOUNTS), /Command failed: tailscale serve status --json/)
  await assert.rejects(exposure.ensure(MOUNTS), /Command failed/)
  assert.deepEqual(down.writes(), [])

  // one mount fails: the others are still tried, and the error names it
  const one = recorder(fixture('foreign-only'), { fail: args => args.includes('--https=8443') })
  const ensure = createTailscaleExposure({ execFileFn: one.execFileFn }).ensure(MOUNTS)
  await assert.rejects(ensure, err => {
    assert.match(err.message, /could not mount 8443\/ -> http:\/\/127\.0\.0\.1:3101: tailscale serve: Command failed/)
    assert.match(err.message, /exit status 1/)
    assert.doesNotMatch(err.message, /8444|10000/)
    return true
  })
  assert.deepEqual(one.writes().map(a => a[3]), ['--https=8444', '--https=8443', '--https=10000'])

  // through reconcileExposure: { ok: false, error }, never a rejection
  const r = await reconcileExposure(createTailscaleExposure({ execFileFn: recorder(fixture('all'), { fail: () => true }).execFileFn }), MOUNTS, { now: () => 2 })
  assert.deepEqual({ ...r, error: r.error.split('\n')[0] }, { ok: false, checkedAt: 2, drift: [], added: [], error: 'tailscale serve: Command failed: tailscale serve status --json' })
})

test('the binary is configurable', async () => {
  const bin = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
  const { execFileFn, calls } = recorder(fixture('foreign-only'))
  await createTailscaleExposure({ execFileFn, bin }).ensure(MOUNTS)
  assert.equal(calls.length, 4)
  assert.ok(calls.every(c => c.cmd === bin))
})

test('the timeout reaches every call', async () => {
  for (const [options, timeout] of [[{}, 30_000], [{ timeoutMs: 5_000 }, 5_000]]) {
    const { execFileFn, calls } = recorder(fixture('foreign-only'))
    await createTailscaleExposure({ execFileFn, ...options }).ensure(MOUNTS)
    assert.equal(calls.length, 4)
    for (const { args, opts } of calls) assert.deepEqual(opts, { timeout }, args.join(' '))
  }
})

test('--socket comes before the subcommand', async () => {
  const socket = '/var/run/tailscale/tailscaled.sock'
  const { execFileFn, calls } = recorder(fixture('foreign-only'))
  await createTailscaleExposure({ execFileFn, socket }).ensure(MOUNTS)
  assert.equal(calls.length, 4)
  for (const { args } of calls) {
    assert.deepEqual(args.slice(0, 2), [`--socket=${socket}`, 'serve'])
    assert.equal(args.filter(a => a.startsWith('--socket')).length, 1)
  }
  // and without one, no --socket at all
  const plain = recorder(fixture('foreign-only'))
  await createTailscaleExposure({ execFileFn: plain.execFileFn }).ensure(MOUNTS)
  assert.ok(plain.calls.every(c => c.args[0] === 'serve'))
})

test('status output that is not JSON rejects', async () => {
  for (const stdout of ['No serve config\n', '{"TCP":', '<html>']) {
    const { execFileFn, writes } = recorder(stdout)
    const exposure = createTailscaleExposure({ execFileFn })
    await assert.rejects(exposure.check(MOUNTS), /tailscale serve status --json printed something that is not JSON/, stdout)
    await assert.rejects(exposure.ensure(MOUNTS), /not JSON/)
    assert.deepEqual(writes(), [])
  }
  // JSON, but not a serve config
  for (const stdout of ['[]', '"x"', '42', 'true']) {
    await assert.rejects(check(stdout), /not a JSON object/, stdout)
  }
})

test('a target with a trailing slash matches', async () => {
  const slashed = edited('all', st => {
    for (const web of Object.values(st.Web)) for (const h of Object.values(web.Handlers)) h.Proxy += '/'
  })
  assert.deepEqual(await check(slashed), { ok: true, drift: [] })
  // and a mount's own trailing slash
  assert.deepEqual(await check(fixture('all'), MOUNTS.map(m => ({ ...m, target: `${m.target}/` }))), { ok: true, drift: [] })
})

test('the exact host:port key wins over another key on the same port', async () => {
  // Another name on 8443 sorts first, and points elsewhere.
  const alias = 'alias.tail1234.ts.net:8443'
  const twoKeys = edited('all', st => ({ ...st, Web: { [alias]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9' } } }, ...st.Web } }))
  assert.equal(Object.keys(JSON.parse(twoKeys).Web)[0], alias)
  assert.deepEqual(await check(twoKeys), { ok: true, drift: [] })
  // With no exact key (a short MagicDNS name), the first key on the port is read.
  const short = MOUNTS.map(m => ({ ...m, host: 'qa-box' }))
  assert.deepEqual(await check(fixture('all'), short), { ok: true, drift: [] })
  assert.deepEqual(driftOf(await check(twoKeys, short)), [['base', 'http://127.0.0.1:9']])
})

test('a malformed mount, or adapter option, is refused before any command runs', async () => {
  const bad = [
    { port: 0 }, { port: 65536 }, { port: '8443' }, { port: 1.5 },
    { path: 'qa' }, { path: '' }, { path: undefined },
    { target: 'ftp://127.0.0.1:3101' }, { target: '--help' }, { target: 'http://127.0.0.1:3101 --bg' }, { target: undefined },
  ]
  for (const change of bad) {
    const { execFileFn, calls } = recorder(fixture('foreign-only'))
    const exposure = createTailscaleExposure({ execFileFn })
    const mounts = [MOUNTS[0], { ...MOUNTS[1], ...change }]
    await assert.rejects(exposure.check(mounts), /tailscale exposure: not a mount/, JSON.stringify(change))
    await assert.rejects(exposure.ensure(mounts), /not a mount/)
    assert.equal(calls.length, 0, JSON.stringify(change))
  }
  for (const mounts of [null, [null], 'x']) {
    await assert.rejects(createTailscaleExposure({ execFileFn: recorder('{}').execFileFn }).check(mounts), /not a mount|mounts/)
  }
  const execFileFn = recorder('{}').execFileFn
  assert.throws(() => createTailscaleExposure({}), /execFileFn/)
  assert.throws(() => createTailscaleExposure(), /execFileFn/)
  for (const timeoutMs of [0, -1, NaN, Infinity, '30000']) {
    assert.throws(() => createTailscaleExposure({ execFileFn, timeoutMs }), /timeoutMs/, String(timeoutMs))
  }
  for (const bin of ['', null, 7]) assert.throws(() => createTailscaleExposure({ execFileFn, bin }), /bin/, String(bin))
  for (const socket of ['', 7]) assert.throws(() => createTailscaleExposure({ execFileFn, socket }), /socket/, String(socket))
})
