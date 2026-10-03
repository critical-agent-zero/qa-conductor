// The expose CLI: runExpose, its exit codes and what it prints, against a fake
// adapter; then bin/qa-conductor-expose.mjs, spawned with a fake `tailscale`
// (a #!/usr/bin/env node shim that logs its argv and prints {} for `serve
// status --json`). Each spawn's PATH holds only the shim's dir, so no real
// tailscale can run.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { runExpose } from '../lib/exposure.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN = path.join(ROOT, 'bin', 'qa-conductor-expose.mjs')
const USAGE_LINE = 'Usage: qa-conductor-expose [--check] [--env FILE] [--config MODULE[#export]] [--tailscale BIN] [--socket PATH] [--help|-h]'

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

  // https origins on loopback are none too, until an allowed host or a public
  // host widens the Host allowlist: then tailscale, as startConductor resolves it
  const https = { ports: CFG.ports, harnessOrigin: 'https://localhost:8444', paneOrigins: { base: 'https://localhost:8443', pr: 'https://localhost:10000' } }
  for (const [extra, mode] of [[{}, 'none'], [{ allowedHosts: ['box.ts.net'] }, 'tailscale'], [{ publicHost: 'box.ts.net' }, 'tailscale']]) {
    const probe = fakeExposure()
    const seen = recordLog()
    assert.equal(await runExpose({ cfg: { ...https, ...extra }, exposure: probe, log: seen.log }), 0, JSON.stringify(extra))
    if (mode === 'none') {
      assert.deepEqual(probe.calls, [], JSON.stringify(extra))
      assert.deepEqual(seen.lines, [['out', 'qa exposure: QA_EXPOSURE=none, nothing to do']])
    } else {
      assert.deepEqual(probe.calls.map(([member, mounts]) => [member, mounts.map(m => m.target)]), [
        ['ensure', ['http://127.0.0.1:3100', 'http://127.0.0.1:3101', 'http://127.0.0.1:3102']],
        ['check', ['http://127.0.0.1:3100', 'http://127.0.0.1:3101', 'http://127.0.0.1:3102']],
      ], JSON.stringify(extra))
      assert.deepEqual(seen.lines, [['out', 'qa exposure: ok (harness https://localhost:8444/qa/)']])
    }
  }
  // a non-loopback bind host makes it tailscale too, which the conductor then
  // refuses: see the next test

  const odd = recordLog()
  assert.equal(await runExpose({ cfg: { ...CFG, exposure: 'caddy' }, exposure, log: odd.log }), 2)
  assert.deepEqual(odd.lines, [['err', 'qa exposure: QA_EXPOSURE must be none or tailscale, got "caddy"']])
  // a public host no origin can be derived from
  const bad = recordLog()
  assert.equal(await runExpose({ cfg: { ...bare, publicHost: 'a b' }, exposure, log: bad.log }), 2)
  assert.match(bad.lines[0][1], /^qa exposure: the harness origin derived from QA_PUBLIC_HOST must be an origin/)
})

test('tailscale mode off a loopback bind host, or a bracketed one, is a config error, as startConductor has it', async () => {
  const https = { ports: CFG.ports, harnessOrigin: 'https://localhost:8444', paneOrigins: { base: 'https://localhost:8443', pr: 'https://localhost:10000' } }
  const cases = [
    // defaulted: the bind host alone is what makes it tailscale
    [{ ...https, host: '0.0.0.0' }, 'qa exposure: QA_EXPOSURE defaults to tailscale because QA_BIND_HOST=0.0.0.0 is not loopback, and the conductor runs tailscale mode only on a loopback bind host (QA_BIND_HOST, cfg.host), got "0.0.0.0"'],
    [{ ...CFG, host: '0.0.0.0' }, 'qa exposure: QA_EXPOSURE is tailscale, and the conductor runs tailscale mode only on a loopback bind host (QA_BIND_HOST, cfg.host), got "0.0.0.0"'],
    [{ ...CFG, host: '192.168.1.5' }, /got "192\.168\.1\.5"$/],
    [{ ...CFG, host: '[::1]' }, 'qa exposure: the bind host (QA_BIND_HOST, cfg.host) takes an IPv6 literal without brackets, as the conductor requires: use "::1", not "[::1]"'],
  ]
  for (const [cfg, line] of cases) {
    const exposure = fakeExposure()
    const { lines, log } = recordLog()
    assert.equal(await runExpose({ cfg, exposure, log }), 2, cfg.host)
    assert.deepEqual(exposure.calls, [], `${cfg.host}: no adapter call`)
    assert.equal(lines.length, 1)
    assert.equal(lines[0][0], 'err')
    if (typeof line === 'string') assert.equal(lines[0][1], line)
    else assert.match(lines[0][1], line)
  }

  // loopback binds are fine, ::1 included
  for (const [host, target] of [['127.0.0.2', 'http://127.0.0.2:3100'], ['localhost', 'http://localhost:3100'], ['::1', 'http://[::1]:3100']]) {
    const exposure = fakeExposure()
    assert.equal(await runExpose({ cfg: { ...CFG, host }, exposure, log: recordLog().log }), 0, host)
    assert.equal(exposure.calls[0][1][0].target, target)
  }
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

// --- the bin -------------------------------------------------------------------

// A fake tailscale CLI. It logs [its own file name, ...argv] as a JSON line to
// $SHIM_LOG, and answers `serve status --json` (after any --socket=) with {}.
const SHIM = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify([path.basename(process.argv[1]), ...args]) + '\\n')
if (args.filter(a => !a.startsWith('--socket=')).join(' ') === 'serve status --json') process.stdout.write('{}\\n')
`
const FIXTURE = ['GITHUB_QA_TOKEN=unused', 'QA_REPO=acme/widget', 'QA_PUBLIC_HOST=h.ts.net', 'QA_ALLOWED_LOGINS=a@github']
const STATUS = ['serve', 'status', '--json']
const ENSURE = [
  ['serve', '--bg', '--https=8444', '--set-path=/qa', 'http://127.0.0.1:3100'],
  ['serve', '--bg', '--https=8443', 'http://127.0.0.1:3101'],
  ['serve', '--bg', '--https=10000', 'http://127.0.0.1:3102'],
]
const MISSING = [
  'qa exposure: drift 8444/qa: want http://127.0.0.1:3100, have nothing',
  'qa exposure: drift 8443/: want http://127.0.0.1:3101, have nothing',
  'qa exposure: drift 10000/: want http://127.0.0.1:3102, have nothing',
]

// A scratch dir with the shim as `tailscale` (and any other names) in
// dir/bin, beside a `node` link for its #! line.
function world({ shims = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-expose-'))
  const bin = path.join(dir, 'bin')
  mkdirSync(bin)
  // the shim is CommonJS whatever package.json is above the scratch dir
  writeFileSync(path.join(bin, 'package.json'), '{"type":"commonjs"}\n')
  for (const name of ['tailscale', ...shims]) writeFileSync(path.join(bin, name), SHIM, { mode: 0o755 })
  symlinkSync(process.execPath, path.join(bin, 'node'))
  const log = path.join(dir, 'tailscale.log')
  const lines = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [])
  return {
    dir,
    shim: name => path.join(bin, name),
    envFile: (lines, name = '.env.qa') => {
      const file = path.join(dir, name)
      writeFileSync(file, `${lines.join('\n')}\n`)
      return file
    },
    // Each call the shim saw, as its argv; `ran` adds which shim it was.
    calls: () => lines().map(([, ...args]) => args),
    ran: () => lines().map(([name]) => name),
    run: (args, { cwd = dir, env = {} } = {}) => new Promise(resolve => {
      execFile(process.execPath, [BIN, ...args], { cwd, env: { PATH: bin, SHIM_LOG: log, ...env }, timeout: 20_000 }, (err, stdout, stderr) => {
        resolve({ code: err ? err.code : 0, stdout, stderr })
      })
    }),
  }
}
const outLines = text => text.split('\n').filter(Boolean)

test('mounts all three, then exits 1 because the shim still reports none', async () => {
  const w = world()
  const r = await w.run(['--env', w.envFile(FIXTURE), '--tailscale', w.shim('tailscale')])
  assert.equal(r.code, 1, r.stderr)
  // ensure reads the status, writes each missing mount; check reads it again
  assert.deepEqual(w.calls(), [STATUS, ...ENSURE, STATUS])
  assert.deepEqual(outLines(r.stdout), [
    'qa exposure: mounted 8444/qa -> http://127.0.0.1:3100',
    'qa exposure: mounted 8443/ -> http://127.0.0.1:3101',
    'qa exposure: mounted 10000/ -> http://127.0.0.1:3102',
  ])
  assert.deepEqual(outLines(r.stderr), MISSING)
})

test('--check never runs serve --bg and exits 1', async () => {
  const w = world()
  const r = await w.run(['--check', '--env', w.envFile(FIXTURE), '--tailscale', w.shim('tailscale')])
  assert.equal(r.code, 1, r.stderr)
  assert.deepEqual(w.calls(), [STATUS])
  assert.equal(r.stdout, '')
  assert.deepEqual(outLines(r.stderr), MISSING)
})

test('QA_EXPOSURE=none exits 0 without calling tailscale', async () => {
  const w = world()
  const file = w.envFile([...FIXTURE, 'QA_EXPOSURE=none'])
  for (const args of [['--env', file], ['--check', '--env', file]]) {
    const r = await w.run(args)
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.stdout, 'qa exposure: QA_EXPOSURE=none, nothing to do\n')
    assert.equal(r.stderr, '')
  }
  assert.deepEqual(w.calls(), [])
})

test('--config loads cfg from MODULE#export', async () => {
  const w = world()
  // a platform's loader: its own defaults (QA_REPO, a harness on :8445), and
  // a note of the path it was called with
  writeFileSync(path.join(w.dir, 'loader.mjs'), [
    `import { writeFileSync } from 'node:fs'`,
    `import { loadConfig } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib/config.mjs')).href)}`,
    `export function loadMine(file) {`,
    `  writeFileSync(new URL('./called-with', import.meta.url), file)`,
    `  return loadConfig(file, { defaults: { QA_REPO: 'acme/widget', QA_HARNESS_ORIGIN: 'https://h.ts.net:8445' } })`,
    `}`,
    `export default async file => ({ ...loadMine(file), paneOrigins: { base: 'https://h.ts.net:9443', pr: 'https://h.ts.net:9444' } })`,
    `export const notAFunction = 1`,
  ].join('\n'))
  const file = w.envFile(FIXTURE.filter(line => !line.startsWith('QA_REPO=')), 'platform.env')

  // the core loadConfig refuses it: no QA_REPO
  const core = await w.run(['--check', '--env', file])
  assert.equal(core.code, 2)
  assert.match(core.stderr, /QA_REPO missing in /)

  // MODULE#export, a path from the working directory
  const named = await w.run(['--check', '--env', 'platform.env', '--config', './loader.mjs#loadMine'])
  assert.equal(named.code, 1, named.stderr)
  assert.equal(readFileSync(path.join(w.dir, 'called-with'), 'utf8'), 'platform.env')
  assert.equal(outLines(named.stderr)[0], 'qa exposure: drift 8445/qa: want http://127.0.0.1:3100, have nothing')

  // the last --config wins, so `npm run expose -- --config ...` overrides the
  // script's own (there is no qa/self.mjs in this dir)
  const later = await w.run(['--config', 'qa/self.mjs#loadSelfQaConfig', '--check', '--env', 'platform.env', '--config', './loader.mjs#loadMine'])
  assert.equal(later.code, 1, later.stderr)
  assert.equal(outLines(later.stderr)[0], 'qa exposure: drift 8445/qa: want http://127.0.0.1:3100, have nothing')

  // MODULE alone calls its default export, which may be async; an absolute path works too
  const fallback = await w.run(['--check', '--env', file, '--config', path.join(w.dir, 'loader.mjs')])
  assert.equal(fallback.code, 1, fallback.stderr)
  assert.deepEqual(outLines(fallback.stderr).slice(1).map(line => line.split(':')[1]), [' drift 9443/', ' drift 9444/'])

  // a missing module or export, or one that isn't a function, is a config error
  for (const spec of ['./loader.mjs#nope', './loader.mjs#notAFunction', './absent.mjs#loadMine']) {
    const r = await w.run(['--check', '--env', file, '--config', spec])
    assert.equal(r.code, 2, spec)
    assert.ok(r.stderr.includes(USAGE_LINE), spec)
  }
  assert.deepEqual(w.calls(), [STATUS, STATUS, STATUS], 'only the three loads that worked called tailscale')
})

// Self-QA's .env.qa leaves QA_REPO and the pane origins to self-QA's defaults,
// so `npm run expose` passes self-QA's loader.
test('--config qa/self.mjs#loadSelfQaConfig, as npm run expose passes it, reads self-QA\'s .env.qa as npm run qa does', async () => {
  const w = world()
  const file = w.envFile([
    'GITHUB_QA_TOKEN=unused', 'QA_PUBLIC_HOST=h.ts.net', 'QA_BASE_ORIGIN=https://h.ts.net:8443', 'QA_PR_ORIGIN=https://h.ts.net:10000',
    'QA_ALLOWED_LOGINS=a@github', `QA_TAILSCALE_BIN=${w.shim('tailscale')}`,
  ])
  const core = await w.run(['--check', '--env', file], { cwd: ROOT })
  assert.equal(core.code, 2)
  assert.match(core.stderr, /QA_REPO missing in /)
  const self = await w.run(['--check', '--env', file, '--config', 'qa/self.mjs#loadSelfQaConfig'], { cwd: ROOT })
  assert.equal(self.code, 1, self.stderr)
  assert.deepEqual(outLines(self.stderr), MISSING)

  // `npm run expose -- --check --env FILE`: the script's own argv, then these
  const [node, bin, ...scriptArgs] = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.expose.split(' ')
  assert.deepEqual([node, bin], ['node', 'bin/qa-conductor-expose.mjs'])
  const script = await w.run([...scriptArgs, '--check', '--env', file], { cwd: ROOT })
  assert.equal(script.code, 1, script.stderr)
  assert.deepEqual(outLines(script.stderr), MISSING)
  assert.deepEqual(w.calls(), [STATUS, STATUS])
})

test('--help and -h print the usage and exit 0 without loading a config or calling tailscale', async () => {
  const w = world() // no .env.qa in its dir
  for (const args of [['--help'], ['-h'], ['--check', '--env', 'absent.env', '--config', './absent.mjs', '--help']]) {
    const r = await w.run(args)
    assert.equal(r.code, 0, `${args}: ${r.stderr}`)
    assert.equal(outLines(r.stdout)[0], USAGE_LINE)
    assert.match(r.stdout, /--tailscale BIN/)
    assert.match(r.stdout, /no\s+deploy/)
    assert.equal(r.stderr, '')
  }
  assert.deepEqual(w.calls(), [])
})

test('an unknown flag, or a config that does not load (the fixture without GITHUB_QA_TOKEN), exits 2 with the usage', async () => {
  const w = world()
  const file = w.envFile(FIXTURE)
  const cases = [
    [['--bogus'], /--bogus/],
    [['--check', 'extra'], /extra/],
    [['--env'], /--env/],
    [['--check=yes', '--env', file], /--check/],
    [['--env', w.envFile(FIXTURE.filter(line => !line.startsWith('GITHUB_QA_TOKEN=')), 'no-token.env')], /GITHUB_QA_TOKEN missing in /],
    [['--env', path.join(w.dir, 'absent.env')], /absent\.env/],
    [['--env', file, '--tailscale', ''], /bin must be/],
    [['--env', file, '--socket', ''], /socket must be/],
  ]
  for (const [args, message] of cases) {
    const r = await w.run(args)
    assert.equal(r.code, 2, `${JSON.stringify(args)}: ${r.stderr}`)
    assert.match(r.stderr, /^qa-conductor-expose: /)
    assert.match(r.stderr, message)
    assert.ok(r.stderr.includes(USAGE_LINE), JSON.stringify(args))
    assert.equal(r.stdout, '')
  }
  assert.deepEqual(w.calls(), [])
})

test('a mount layout no front door can publish exits 2, without the usage', async () => {
  const w = world()
  const r = await w.run(['--env', w.envFile([...FIXTURE, 'QA_HARNESS_PORT=0'])])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /^qa exposure: the harness listen port must be an integer from 1 to 65535, got 0/)
  assert.ok(!r.stderr.includes('Usage'))
  assert.deepEqual(w.calls(), [])
})

test('the CLI is --tailscale, else QA_TAILSCALE_BIN in the env file, else tailscale on PATH; --socket comes first', async () => {
  const w = world({ shims: ['ts-flag', 'ts-file'] })
  const plain = w.envFile(FIXTURE)
  const named = w.envFile([...FIXTURE, `QA_TAILSCALE_BIN=${w.shim('ts-file')}`], 'named.env')
  await w.run(['--check', '--env', plain])
  await w.run(['--check', '--env', named])
  await w.run(['--check', '--env', named, '--tailscale', w.shim('ts-flag')])
  assert.deepEqual(w.ran(), ['tailscale', 'ts-file', 'ts-flag'])

  const sock = world()
  const r = await sock.run(['--check', '--env', sock.envFile(FIXTURE), '--socket', '/run/ts/tailscaled.sock'])
  assert.equal(r.code, 1, r.stderr)
  assert.deepEqual(sock.calls(), [['--socket=/run/ts/tailscaled.sock', ...STATUS]])
})

test('the env file is --env, else $QA_ENV_FILE, else ./.env.qa', async () => {
  const w = world()
  w.envFile([...FIXTURE, 'QA_EXPOSURE=none'])
  const other = w.envFile(FIXTURE, 'other.env')
  const cwdFile = await w.run(['--check'])
  assert.equal(cwdFile.code, 0, cwdFile.stderr)
  assert.match(cwdFile.stdout, /nothing to do/)
  const fromEnv = await w.run(['--check'], { env: { QA_ENV_FILE: other } })
  assert.equal(fromEnv.code, 1, fromEnv.stderr)
  const flag = await w.run(['--check', '--env', '.env.qa'], { env: { QA_ENV_FILE: other } })
  assert.equal(flag.code, 0, flag.stderr)
  assert.deepEqual(w.calls(), [STATUS])
})
