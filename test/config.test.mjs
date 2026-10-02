import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadConfig, parseEnvFile } from '../lib/config.mjs'

function envFile(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-config-'))
  const path = join(dir, '.env.qa')
  writeFileSync(path, lines.join('\n'))
  return path
}

const REQUIRED = ['GITHUB_QA_TOKEN=tok', 'QA_OPERATOR_EMAIL=op@homefree.local', 'QA_REPO=acme/widget', 'QA_PUBLIC_HOST=w.ts.net']

test('parseEnvFile: KEY=value lines, comments/blanks ignored, values may contain =', () => {
  assert.deepEqual(parseEnvFile(envFile(['# c', '', '   ', 'A=1', 'B=x=y=='])), { A: '1', B: 'x=y==' })
})

test('generic defaults: ports, pane origins from public host, verdict labels', () => {
  const c = loadConfig(envFile(REQUIRED))
  assert.equal(c.githubToken, 'tok')
  assert.equal(c.operatorEmail, 'op@homefree.local')
  assert.equal(c.repo, 'acme/widget')
  assert.equal(c.publicHost, 'w.ts.net')
  assert.equal(c.idleMinutes, 30)
  assert.deepEqual(c.ports, { harness: 3100, base: 3101, pr: 3102 })
  assert.deepEqual(c.paneOrigins, { base: 'https://w.ts.net:8443', pr: 'https://w.ts.net:10000' })
  assert.deepEqual(c.verdictLabels, { accept: 'qa-approved', reject: 'qa-changes-requested' })
  // the raw map is exposed so a platform can read its own keys
  assert.equal(c.env.QA_REPO, 'acme/widget')
})

test('overrides: ports, origins, labels, idle minutes (a number)', () => {
  const c = loadConfig(envFile([...REQUIRED,
    'QA_HARNESS_PORT=4100', 'QA_BASE_PROXY_PORT=4101', 'QA_PR_PROXY_PORT=4102',
    'QA_BASE_ORIGIN=http://127.0.0.1:4101', 'QA_PR_ORIGIN=http://127.0.0.1:4102',
    'QA_LABEL_ACCEPT=ok', 'QA_LABEL_REJECT=nope', 'QA_IDLE_MINUTES=15']))
  assert.deepEqual(c.ports, { harness: 4100, base: 4101, pr: 4102 })
  assert.deepEqual(c.paneOrigins, { base: 'http://127.0.0.1:4101', pr: 'http://127.0.0.1:4102' })
  assert.deepEqual(c.verdictLabels, { accept: 'ok', reject: 'nope' })
  assert.equal(c.idleMinutes, 15)
})

test('platform defaults fill gaps; file values win', () => {
  const c = loadConfig(envFile(['GITHUB_QA_TOKEN=tok', 'QA_OPERATOR_EMAIL=op@homefree.local', 'QA_REPO=file/wins']),
    { defaults: { QA_REPO: 'default/repo', QA_PUBLIC_HOST: 'd.ts.net' } })
  assert.equal(c.repo, 'file/wins')
  assert.equal(c.publicHost, 'd.ts.net')
})

test('no app defaults: each required key is enforced', () => {
  for (const missing of ['GITHUB_QA_TOKEN', 'QA_REPO', 'QA_PUBLIC_HOST']) {
    const lines = REQUIRED.filter(l => !l.startsWith(`${missing}=`))
    assert.throws(() => loadConfig(envFile(lines)), new RegExp(missing))
  }
})

test('QA_OPERATOR_EMAIL is optional: operatorEmail is null when unset', () => {
  const c = loadConfig(envFile(REQUIRED.filter(l => !l.startsWith('QA_OPERATOR_EMAIL='))))
  assert.equal(c.operatorEmail, null)
})

test('QA_PUBLIC_HOST is required only when the two pane origins are not both set', () => {
  const noHost = REQUIRED.filter(l => !l.startsWith('QA_PUBLIC_HOST='))
  const c = loadConfig(envFile([...noHost, 'QA_BASE_ORIGIN=http://127.0.0.1:3101', 'QA_PR_ORIGIN=http://127.0.0.1:3102']))
  assert.equal(c.publicHost, null)
  assert.deepEqual(c.paneOrigins, { base: 'http://127.0.0.1:3101', pr: 'http://127.0.0.1:3102' })
  // one origin alone still needs the host to derive the other
  assert.throws(() => loadConfig(envFile([...noHost, 'QA_BASE_ORIGIN=http://127.0.0.1:3101'])), /QA_PUBLIC_HOST/)
  assert.throws(() => loadConfig(envFile([...noHost, 'QA_PR_ORIGIN=http://127.0.0.1:3102'])), /QA_PUBLIC_HOST/)
})

test('required: a platform can re-require keys; token and repo stay required', () => {
  const noEmail = REQUIRED.filter(l => !l.startsWith('QA_OPERATOR_EMAIL='))
  assert.throws(() => loadConfig(envFile(noEmail), { required: ['QA_OPERATOR_EMAIL'] }), /QA_OPERATOR_EMAIL/)
  assert.equal(loadConfig(envFile(REQUIRED), { required: ['QA_OPERATOR_EMAIL'] }).operatorEmail, 'op@homefree.local')
  // a re-required key may come from the platform defaults
  assert.equal(loadConfig(envFile(noEmail), { required: ['QA_OPERATOR_EMAIL'], defaults: { QA_OPERATOR_EMAIL: 'd@x' } }).operatorEmail, 'd@x')
  // `required` adds to the core keys; it cannot waive them
  for (const missing of ['GITHUB_QA_TOKEN', 'QA_REPO']) {
    const lines = REQUIRED.filter(l => !l.startsWith(`${missing}=`))
    assert.throws(() => loadConfig(envFile(lines), { required: [] }), new RegExp(missing))
  }
})

test('QA_BIND_HOST: the listen host defaults to loopback', () => {
  assert.equal(loadConfig(envFile(REQUIRED)).host, '127.0.0.1')
  assert.equal(loadConfig(envFile([...REQUIRED, 'QA_BIND_HOST=0.0.0.0'])).host, '0.0.0.0')
})

test('QA_ALLOWED_HOSTS: comma-separated, trimmed, empties dropped; default none', () => {
  assert.deepEqual(loadConfig(envFile(REQUIRED)).allowedHosts, [])
  const c = loadConfig(envFile([...REQUIRED, 'QA_ALLOWED_HOSTS= qa.example.com ,, host.docker.internal,']))
  assert.deepEqual(c.allowedHosts, ['qa.example.com', 'host.docker.internal'])
})

// --- 0.3.0: the harness origin --------------------------------------------------

const NO_HOST = REQUIRED.filter(l => !l.startsWith('QA_PUBLIC_HOST='))
const LOOPBACK_PANES = ['QA_BASE_ORIGIN=http://127.0.0.1:3101', 'QA_PR_ORIGIN=http://127.0.0.1:3102']

test('the harness origin defaults to :8444 on the public host; QA_HARNESS_ORIGIN overrides it, path dropped', () => {
  assert.equal(loadConfig(envFile(REQUIRED)).harnessOrigin, 'https://w.ts.net:8444')
  const c = loadConfig(envFile([...REQUIRED, 'QA_HARNESS_ORIGIN=https://h.ts.net:8445/qa/']))
  assert.equal(c.harnessOrigin, 'https://h.ts.net:8445', 'an origin only: no path, no trailing slash')
  for (const bad of ['h.ts.net:8444', '*', 'ftp://h.ts.net']) {
    assert.throws(() => loadConfig(envFile([...REQUIRED, `QA_HARNESS_ORIGIN=${bad}`])), /QA_HARNESS_ORIGIN must be an origin/, bad)
  }
  // the public host wins over a loopback listen address
  assert.equal(loadConfig(envFile([...REQUIRED, ...LOOPBACK_PANES])).harnessOrigin, 'https://w.ts.net:8444')
})

test('without a public host the harness origin is the loopback listen address: http://127.0.0.1:3100, http://[::1]:3100; null on port 0', () => {
  const load = (...lines) => loadConfig(envFile([...NO_HOST, ...LOOPBACK_PANES, ...lines])).harnessOrigin
  assert.equal(load(), 'http://127.0.0.1:3100')
  assert.equal(load('QA_HARNESS_PORT=4100'), 'http://127.0.0.1:4100')
  assert.equal(load('QA_BIND_HOST=::1'), 'http://[::1]:3100')
  assert.equal(load('QA_BIND_HOST=localhost'), 'http://localhost:3100')
  assert.equal(load('QA_BIND_HOST=127.0.0.2'), 'http://127.0.0.2:3100')
  // the conductor derives it from the bound port instead
  assert.equal(load('QA_HARNESS_PORT=0'), null)
  // an explicit origin still wins
  assert.equal(load('QA_HARNESS_ORIGIN=http://localhost:3100'), 'http://localhost:3100')
})

test('a non-loopback QA_BIND_HOST with no public host needs QA_HARNESS_ORIGIN', () => {
  for (const extra of [[], ['QA_HARNESS_PORT=0']]) {
    assert.throws(() => loadConfig(envFile([...NO_HOST, ...LOOPBACK_PANES, 'QA_BIND_HOST=0.0.0.0', ...extra])), err => {
      assert.match(err.message, /^QA_HARNESS_ORIGIN missing in /)
      assert.match(err.message, /QA_BIND_HOST=0\.0\.0\.0/)
      return true
    }, extra.join())
  }
  const c = loadConfig(envFile([...NO_HOST, ...LOOPBACK_PANES, 'QA_BIND_HOST=0.0.0.0', 'QA_HARNESS_ORIGIN=https://box.lan:3100']))
  assert.equal(c.harnessOrigin, 'https://box.lan:3100')
})

test('QA_HARNESS_ORIGIN, QA_BASE_ORIGIN and QA_PR_ORIGIN must be http(s) origins and are normalized', () => {
  for (const key of ['QA_HARNESS_ORIGIN', 'QA_BASE_ORIGIN', 'QA_PR_ORIGIN']) {
    for (const bad of ['h.ts.net:8444', '*', 'ftp://h.ts.net', 'file:///x', 'data:text/html,x', 'https://a;b', "https://a'b", 'https://a,b']) {
      assert.throws(() => loadConfig(envFile([...REQUIRED, `${key}=${bad}`])), new RegExp(`^Error: ${key} must be an origin such as https://host:8444`), `${key}=${bad}`)
    }
  }
  const c = loadConfig(envFile([...REQUIRED,
    'QA_HARNESS_ORIGIN=HTTPS://H.TS.NET:443/qa/', 'QA_BASE_ORIGIN=http://127.0.0.1:4101/', 'QA_PR_ORIGIN=https://W.ts.net:10000/login?x=1#k']))
  assert.equal(c.harnessOrigin, 'https://h.ts.net')
  assert.deepEqual(c.paneOrigins, { base: 'http://127.0.0.1:4101', pr: 'https://w.ts.net:10000' })
  // the derived defaults go through the same rule
  const derived = loadConfig(envFile([...NO_HOST, 'QA_PUBLIC_HOST=W.TS.NET']))
  assert.equal(derived.harnessOrigin, 'https://w.ts.net:8444')
  assert.deepEqual(derived.paneOrigins, { base: 'https://w.ts.net:8443', pr: 'https://w.ts.net:10000' })
  assert.throws(() => loadConfig(envFile([...NO_HOST, 'QA_PUBLIC_HOST=w.ts.net;x'])), /must be an origin/)
})

test('QA_FRAME_ANCESTORS: comma-separated origins, normalized; anything else throws', () => {
  assert.deepEqual(loadConfig(envFile(REQUIRED)).frameAncestors, [])
  const c = loadConfig(envFile([...REQUIRED, 'QA_FRAME_ANCESTORS= https://A.ts.net:8444/qa/ ,, http://127.0.0.1:3100,']))
  assert.deepEqual(c.frameAncestors, ['https://a.ts.net:8444', 'http://127.0.0.1:3100'])
  for (const bad of ['https://ok.ts.net, nope', '*', "'self'", 'https://a;b', 'file:///x']) {
    assert.throws(() => loadConfig(envFile([...REQUIRED, `QA_FRAME_ANCESTORS=${bad}`])), /^Error: QA_FRAME_ANCESTORS must be an origin/, bad)
  }
})

test('the harness and the two panes must be three different origins', () => {
  const refuses = (lines, re) => assert.throws(() => loadConfig(envFile(lines)), err => {
    assert.match(err.message, /must be three different origins/)
    assert.match(err.message, re)
    return true
  }, lines.join(' '))
  refuses([...REQUIRED, 'QA_HARNESS_ORIGIN=https://w.ts.net:8443'], /harness and base/)
  refuses([...REQUIRED, 'QA_HARNESS_ORIGIN=https://W.TS.NET:10000/'], /harness and pr/)
  refuses([...REQUIRED, 'QA_BASE_ORIGIN=https://w.ts.net:10000/'], /base and pr/)
  // the harness origin derived from the loopback listen address counts too
  refuses([...NO_HOST, 'QA_BASE_ORIGIN=http://127.0.0.1:3100', 'QA_PR_ORIGIN=http://127.0.0.1:3102'], /harness and base/)
  // on port 0 the panes are still compared with each other
  refuses([...NO_HOST, 'QA_HARNESS_PORT=0', 'QA_BASE_ORIGIN=http://127.0.0.1:3101', 'QA_PR_ORIGIN=http://127.0.0.1:3101/'], /base and pr/)
  // another port, scheme or host is another origin
  assert.ok(loadConfig(envFile([...NO_HOST, ...LOOPBACK_PANES, 'QA_HARNESS_ORIGIN=https://127.0.0.1:3101'])))
})

// Browsers send Fetch Metadata only to https and loopback origins. Without it,
// another page's <img> or <iframe> GET carries neither Sec-Fetch-Site nor
// Origin, and the guards take it for curl.
test('an http origin must be loopback: browsers send no Sec-Fetch-* headers to plain http anywhere else', () => {
  for (const [key, guard] of [['QA_HARNESS_ORIGIN', 'harness API guard'], ['QA_BASE_ORIGIN', 'pane request guard'], ['QA_PR_ORIGIN', 'pane request guard']]) {
    for (const value of ['http://box.lan:3100', 'http://192.168.1.5:3100', 'http://h.tail1.ts.net:3100', 'http://0.0.0.0:3100']) {
      assert.throws(() => loadConfig(envFile([...REQUIRED, `${key}=${value}/`])), err => {
        assert.equal(err.message, `${key} ${value}: browsers send no Sec-Fetch-* headers to a plain-http origin off loopback, so the ${guard} can't tell other pages apart; use https or a loopback address`)
        return true
      }, `${key}=${value}`)
    }
  }
  // https anywhere; http on 127.0.0.0/8, ::1 and localhost
  const c = loadConfig(envFile([...NO_HOST, 'QA_BIND_HOST=0.0.0.0',
    'QA_HARNESS_ORIGIN=https://box.lan:3100', 'QA_BASE_ORIGIN=http://localhost:3101', 'QA_PR_ORIGIN=http://[::1]:3102']))
  assert.deepEqual([c.harnessOrigin, c.paneOrigins], ['https://box.lan:3100', { base: 'http://localhost:3101', pr: 'http://[::1]:3102' }])
  assert.equal(loadConfig(envFile([...NO_HOST, ...LOOPBACK_PANES, 'QA_HARNESS_ORIGIN=http://127.0.0.2:3100'])).harnessOrigin, 'http://127.0.0.2:3100')
})
