// Integration tests for startConductor over real HTTP (ephemeral ports) with
// fake adapters — no docker, no network beyond loopback.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'

import { startConductor } from '../lib/server.mjs'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Fake adapter set. `ensureBuilt` for a PR listed in `hang` blocks until the
// test releases it — modelling a boot stuck waiting on a GHCR image. The
// startup sweep blocks on `sweepGate` when given, then fails if `sweepFails`;
// `provisioner` overrides members (`{ sweep: undefined }` removes the sweep).
// `exposure` is passed as adapters.exposure (see fakeExposure). The logger
// records every line, then throws on one that matches `logThrowsOn`.
// Each pane "app" is a real loopback server, so the pane proxies can be
// exercised.
function makeWorld({
  hang = {}, failAt = null, sweepGate = null, sweepFails = false, provisioner: provisionerOverrides = {},
  cfg: cfgOverrides = {}, readBaseEnv: readBaseEnvOverride = null, exposure = null, logThrowsOn = null,
} = {}) {
  const calls = []
  // '/page' answers HTML, so the proxy injects the bridge; anything else is text.
  const app = name => http.createServer((req, res) => {
    if (req.url === '/page') res.setHeader('content-type', 'text/html')
    res.end(req.url === '/page' ? `<head></head>${name}` : name)
  })
  const apps = { base: app('pane-base'), pr: app('pane-pr') }
  for (const s of Object.values(apps)) s.listen(0, '127.0.0.1')
  const appPort = role => apps[role].address().port
  const provisioner = {
    provisionDatabase: async ({ paneRef }) => {
      calls.push(['provisionDatabase', paneRef.role])
      return { dsn: `dsn-${paneRef.role}`, db: { dsn: `dsn-${paneRef.role}`, query: async () => '1' } }
    },
    reserveServices: async ({ paneRef }) => ({ app: { url: `http://127.0.0.1:${appPort(paneRef.role)}`, port: appPort(paneRef.role) } }),
    launchServices: async () => { if (failAt === 'launchServices') throw new Error('launch failed') },
    waitHealthy: async () => {},
    teardown: async ({ paneRef }) => { calls.push(['teardown', paneRef.role]) },
    sweep: async () => {
      calls.push(['sweep'])
      if (sweepGate) await sweepGate.promise
      if (sweepFails) throw new Error('docker unavailable')
      calls.push(['sweep-done'])
    },
    logs: async ({ paneRef, stage, lines }) => { calls.push(['logs', paneRef.role, stage, lines]); return 'tail-lines' },
    ...provisionerOverrides,
  }
  const build = {
    migrationStrategy: 'on-boot',
    ensureBuilt: async (pr, { signal } = {}) => {
      calls.push(['ensureBuilt', pr])
      if (hang[pr]) {
        // honour abort like the real adapter does, else wait for release
        await Promise.race([
          hang[pr].promise,
          new Promise((_, rej) => signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })),
        ])
      }
    },
    resolveBaseImages: async () => ({ services: { app: 'img:base' }, migrate: null }),
    resolvePrImages: async pr => ({ services: { app: `img:pr-${pr}` }, migrate: null }),
  }
  const adapters = {
    provisioner,
    build,
    seed: { databases: ['idp'], seedPane: async () => {} },
    envTransform: { derivePaneEnv: ({ pane }) => ({ app: { DSN: pane.dsn } }) },
    auth: { requiresDb: false, establishSession: async ({ pane }) => ({ landingUrl: `login-${pane.ref.role}`, cookies: [] }) },
    ...(exposure ? { exposure } : {}),
  }
  // Ungated: these https origins would otherwise put it in tailscale mode.
  const cfg = {
    publicHost: 'h.ts.net', operatorEmail: 'op@homefree.local', idleMinutes: 30,
    ports: { harness: 0, base: 0, pr: 0 },
    paneOrigins: { base: 'https://h:8443', pr: 'https://h:10000' },
    verdictLabels: { accept: 'ok', reject: 'nope' },
    exposure: 'none',
    ...cfgOverrides,
  }
  const github = {
    listOpenPrs: async () => [{ number: 7, title: 't', headRef: 'r', author: 'a', headSha: 'abc' }],
    prHead: async () => 'abc',
    postComment: async pr => { calls.push(['comment', pr]); return 'https://c' },
    setQaLabel: async (pr, label) => { calls.push(['label', pr, label]) },
  }
  const fsx = { readFile: async () => 'x' }
  const readBaseEnv = readBaseEnvOverride ?? (async () => { calls.push(['readBaseEnv']); return { A: '1' } })
  const logLines = []
  const errorLines = []
  const lines = [] // both, in order
  const record = into => (...a) => {
    const line = a.join(' ')
    into.push(line)
    lines.push(line)
    if (logThrowsOn?.test(line)) throw new Error('the logger failed')
  }
  const quiet = { log: record(logLines), error: record(errorLines) }
  const conductor = startConductor({ cfg, github, fsx, adapters, readBaseEnv, log: quiet })
  if (exposure) exposure.servers = conductor.servers
  const closeApps = () => { for (const s of Object.values(apps)) s.close() }
  // stop() leaves open connections alone; an idle keep-alive socket fetch()
  // opened would hold the test process up to its 4s idle timeout.
  const c = {
    ...conductor,
    stop() {
      conductor.stop()
      for (const s of Object.values(conductor.servers)) s.closeAllConnections()
      closeApps()
    },
  }
  return { c, conductor, closeApps, calls, adapters, github, cfg, logLines, errorLines, lines }
}

async function proxyPort(server) {
  if (!server.listening) await new Promise(r => server.once('listening', r))
  return server.address().port
}

async function harnessPort(c) {
  return proxyPort(c.servers.harness)
}

async function allPorts(c) {
  return {
    harness: await harnessPort(c),
    base: await proxyPort(c.servers.baseProxy),
    pr: await proxyPort(c.servers.prProxy),
  }
}

// POSTs always carry a JSON content type (the harness requires it). `headers`
// adds to them, e.g. ALLOWED on a gated conductor.
async function api(port, method, path, body, headers = {}) {
  const post = method === 'POST'
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { ...(post ? { 'content-type': 'application/json' } : {}), ...headers }, body: post ? JSON.stringify(body ?? {}) : undefined,
  })
  return res.json()
}

// A request with full control over the headers (fetch cannot set Host).
function raw(port, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    if (body != null) req.write(body)
    req.end()
  })
}

// Collect server-sent events until `until(events)` holds.
async function sseEvents(port, until, ms = 3000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  const events = []
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/progress`, { signal: ac.signal })
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error('stream ended')
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)))
      }
      if (until(events)) return events
    }
  } finally {
    clearTimeout(timer)
    ac.abort()
  }
}

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('waitFor timed out')
    await new Promise(r => setTimeout(r, 10))
  }
}

test('happy path: a session boots to ready with pane login urls', async () => {
  const { c } = makeWorld()
  try {
    const port = await harnessPort(c)
    assert.deepEqual(await api(port, 'POST', '/api/session', { pr: 7 }), { ok: true })
    const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'ready' && s })
    assert.equal(st.pr, 7)
    assert.equal(st.panes.base, 'login-base')
    assert.equal(st.panes.pr, 'login-pr')
  } finally { c.stop() }
})

// Regression (2026-09-25 incident): a boot stuck in ensureBuilt survived
// /api/teardown; when it later failed, its catch path tore down the NEWER
// session's deterministically-named containers and wrote its error into the
// newer session's state.
test('teardown cancels an in-flight boot; the stale boot never touches a newer session', async () => {
  const hang = { 205: deferred() }
  const { c, calls } = makeWorld({ hang })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 205 })
    await waitFor(() => calls.some(x => x[0] === 'ensureBuilt' && x[1] === 205))

    await api(port, 'POST', '/api/teardown') // must abort the pending 205 boot
    await api(port, 'POST', '/api/session', { pr: 235 })
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'ready')

    // The stale boot's wait now fails (even if something released it late).
    hang[205].reject(new Error('timed out waiting for GHCR tag pr-205'))
    await new Promise(r => setTimeout(r, 50))

    const st = await api(port, 'GET', '/api/state')
    assert.equal(st.status, 'ready', 'newer session must still be ready')
    assert.equal(st.pr, 235)
    assert.equal(st.error, null)
    // Only the explicit /api/teardown tore panes down (once per role); the
    // stale boot's failure must not add another teardown.
    assert.deepEqual(calls.filter(x => x[0] === 'teardown').map(x => x[1]), ['base', 'pr'])
  } finally { c.stop() }
})

test('takeover also cancels the in-flight boot', async () => {
  const hang = { 1: deferred() }
  const { c, calls } = makeWorld({ hang })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 1 })
    await waitFor(() => calls.some(x => x[0] === 'ensureBuilt' && x[1] === 1))
    await api(port, 'POST', '/api/session', { pr: 2, takeover: true })
    const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'ready' && s })
    assert.equal(st.pr, 2)
    hang[1].resolve() // a late success of the stale boot must be ignored too
    await new Promise(r => setTimeout(r, 50))
    const after = await api(port, 'GET', '/api/state')
    assert.equal(after.pr, 2)
    assert.equal(after.status, 'ready')
    assert.equal(after.prTag, 'img:pr-2', 'stale boot must not overwrite the newer session tags')
    // and the stale boot must not have gone on to provision/launch anything
    assert.equal(calls.filter(x => x[0] === 'ensureBuilt').length, 2)
  } finally { c.stop() }
})

// --- Stage 2 B: the core reaches infra only through the seams --------------

test('startup calls provisioner.sweep; a provisioner without sweep is fine', async () => {
  const { c, calls } = makeWorld()
  try {
    await harnessPort(c)
    await waitFor(() => calls.some(x => x[0] === 'sweep'))
  } finally { c.stop() }
})

test('the pane env is derived from readBaseEnv', async () => {
  const { c, calls } = makeWorld()
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'ready')
    assert.equal(calls.filter(x => x[0] === 'readBaseEnv').length, 1)
  } finally { c.stop() }
})

test('/api/prs merges build.describePrs readiness; absent describePrs means none', async () => {
  const { c, adapters } = makeWorld()
  try {
    const port = await harnessPort(c)
    const before = (await api(port, 'GET', '/api/prs')).prs[0]
    assert.equal(before.imageStatus, 'none')
    assert.equal(before.title, 't')
    adapters.build.describePrs = async prs => prs.map(p => ({ number: p.number, status: 'building', runUrl: 'run' }))
    const after = (await api(port, 'GET', '/api/prs')).prs[0]
    assert.deepEqual([after.number, after.imageStatus, after.runUrl], [7, 'building', 'run'])
  } finally { c.stop() }
})

test('/api/build-status asks describePrs about the PR head', async () => {
  const { c, adapters } = makeWorld()
  try {
    const port = await harnessPort(c)
    assert.deepEqual(await api(port, 'GET', '/api/build-status?pr=7'), { pr: 7, status: 'none', exists: false, runUrl: null })
    let seen = null
    adapters.build.describePrs = async prs => { seen = prs; return [{ number: 7, status: 'built', runUrl: null }] }
    assert.deepEqual(await api(port, 'GET', '/api/build-status?pr=7'), { pr: 7, status: 'built', exists: true, runUrl: null })
    // no github.prInfo: the prHead fallback
    assert.deepEqual(seen, [{ number: 7, headSha: 'abc' }])
  } finally { c.stop() }
})

test('pane proxies 503 without a session, route to the reserved ports once ready, 503 after teardown', async () => {
  const { c } = makeWorld()
  try {
    const port = await harnessPort(c)
    const base = await proxyPort(c.servers.baseProxy)
    const pr = await proxyPort(c.servers.prProxy)
    assert.equal((await fetch(`http://127.0.0.1:${base}/x`)).status, 503)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'ready')
    assert.equal(await (await fetch(`http://127.0.0.1:${base}/x`)).text(), 'pane-base')
    assert.equal(await (await fetch(`http://127.0.0.1:${pr}/x`)).text(), 'pane-pr')
    await api(port, 'POST', '/api/teardown')
    assert.equal((await fetch(`http://127.0.0.1:${pr}/x`)).status, 503)
  } finally { c.stop() }
})

test('pane origins come from config; verdict uses the configured labels', async () => {
  const { c, calls } = makeWorld()
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'ready' && s })
    assert.equal(st.panes.baseOrigin, 'https://h:8443')
    assert.equal(st.panes.prOrigin, 'https://h:10000')
    const prev = await api(port, 'GET', '/api/verdict/preview?verdict=reject')
    assert.deepEqual([prev.applies, prev.removes], ['nope', 'ok'])
    assert.match(prev.body, /qa-conductor-verdict/)
    await api(port, 'POST', '/api/verdict', { verdict: 'accept', notes: '' })
    assert.deepEqual(calls.find(x => x[0] === 'label'), ['label', 7, 'ok'])
  } finally { c.stop() }
})

test('a failed boot surfaces provisioner.logs for the failing pane, read before teardown', async () => {
  const { c, calls } = makeWorld({ failAt: 'launchServices' })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'error' && s })
    assert.equal(st.error.step, 'starting')
    await waitFor(() => calls.some(x => x[0] === 'logs'))
    // the base pane launches first, so it is the one that failed
    assert.deepEqual(calls.find(x => x[0] === 'logs'), ['logs', 'base', 'starting', 40])
    const seq = calls.map(x => x[0])
    assert.ok(seq.indexOf('logs') < seq.indexOf('teardown'), 'the tail is read while the pane still exists')
    assert.equal(calls.filter(x => x[0] === 'logs').length, 1, 'no second read after teardown')
  } finally { c.stop() }
})

// --- 0.2.0: listen host ---------------------------------------------------------

test('all three servers bind 127.0.0.1 by default and log host:port', async () => {
  const { c, logLines } = makeWorld()
  try {
    for (const name of ['harness', 'baseProxy', 'prProxy']) {
      const port = await proxyPort(c.servers[name])
      assert.equal(c.servers[name].address().address, '127.0.0.1', name)
      assert.ok(logLines.some(l => l.includes(`127.0.0.1:${port}`)), `${name} log line names host:port`)
    }
  } finally { c.stop() }
})

// --- 0.2.0: browser-request hardening ------------------------------------------

test('a Host header outside the allowlist gets 421 on all three servers', async () => {
  const { c } = makeWorld()
  try {
    for (const name of ['harness', 'baseProxy', 'prProxy']) {
      const port = await proxyPort(c.servers[name])
      const res = await raw(port, { path: '/', headers: { host: `rebound.attacker.example:${port}` } })
      assert.equal(res.status, 421, name)
    }
    const port = await harnessPort(c)
    assert.equal((await raw(port, { method: 'POST', path: '/api/teardown', headers: { host: 'attacker.example', 'content-type': 'application/json' }, body: '{}' })).status, 421)
  } finally { c.stop() }
})

// A request target the URL parser rejects used to reject the async handler
// before the Host check ran, crashing the conductor.
test('an unparseable request target gets 421/400 and the harness stays up', async () => {
  const { c } = makeWorld()
  try {
    const port = await harnessPort(c)
    assert.equal((await raw(port, { path: '//x:99999', headers: { host: 'attacker.example' } })).status, 421)
    for (const path of ['//', '//x:99999', '//a%20b']) {
      assert.equal((await raw(port, { path })).status, 400, path)
    }
    assert.equal((await raw(port, { path: '/api/state' })).status, 200)
  } finally { c.stop() }
})

test('allowed Hosts: loopback, the public host, the pane origin hosts, the harness origin host, QA_ALLOWED_HOSTS', async () => {
  const { c, cfg } = makeWorld({ cfg: { allowedHosts: ['qa.corp.example'], harnessOrigin: 'https://harness.example:8445' } })
  try {
    const port = await harnessPort(c)
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, 'h.ts.net', 'H.TS.NET:443', 'h:8443', 'qa.corp.example', 'harness.example', 'HARNESS.example:8445']) {
      assert.equal((await raw(port, { path: '/api/state', headers: { host } })).status, 200, host)
    }
    // pane origins are read per request (a platform may assign them after start)
    assert.equal((await raw(port, { path: '/api/state', headers: { host: 'late.example' } })).status, 421)
    cfg.paneOrigins = { base: 'http://late.example:4101', pr: 'http://127.0.0.1:4102' }
    assert.equal((await raw(port, { path: '/api/state', headers: { host: 'late.example' } })).status, 200)
    const base = await proxyPort(c.servers.baseProxy)
    assert.equal((await raw(base, { path: '/', headers: { host: 'late.example:4101' } })).status, 503, 'proxies share the allowlist')
    assert.equal((await raw(base, { path: '/', headers: { host: 'harness.example' } })).status, 503)
  } finally { c.stop() }
})

// PR code in a pane runs in the reviewer's browser, and so does any page the
// reviewer has open: only the harness page itself may use the API. Another
// page can't read the answers, but its writes would run, and each read of
// /api/prs or /api/build-status spends GitHub API calls on the conductor's
// token (merged from homefree #329's three harness API tests).
test('every /api/* request from another page gets 403, reads and the event stream included; the page itself and non-browser clients pass', async () => {
  const { c, calls, github } = makeWorld()
  try {
    const port = await harnessPort(c)
    const host = `127.0.0.1:${port}`
    const hits = []
    github.listOpenPrs = async () => { hits.push('listOpenPrs'); return [] }
    github.prHead = async () => { hits.push('prHead'); return 'abc' }
    const json = { 'content-type': 'application/json' }
    const post = (path, headers) => raw(port, { method: 'POST', path, headers: { host, ...json, ...headers }, body: '{"pr":7,"verdict":"accept"}' })
    for (const headers of [
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      // sec-fetch-site wins over a matching origin
      { 'sec-fetch-site': 'cross-site', origin: `http://${host}` },
      // a pane's page: another port of the same host
      { 'sec-fetch-site': 'same-site', origin: 'https://h:10000' },
      { origin: 'http://attacker.example' },
      { origin: `http://127.0.0.1:${port + 1}` },
      { origin: 'null' },
      { origin: 'not a url' },
    ]) {
      // the check covers every /api/* request, routed or not
      for (const path of ['/api/teardown', '/qa/api/teardown', '/qa/api/session', '/qa/api/verdict', '/api/nope']) {
        const res = await post(path, headers)
        assert.equal(res.status, 403, `${path} ${JSON.stringify(headers)}`)
        assert.match(res.body, /cross-site request refused/)
      }
    }
    const reads = [
      '/qa/api/prs', '/api/prs', '/qa/api/build-status?pr=7', '/qa/api/state', '/qa/api/progress',
      '/qa/api/verdict/preview?verdict=accept', '/qa/api/nope',
    ]
    for (const headers of [
      // <img src="http://127.0.0.1:3100/qa/api/prs"> on another site
      { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' },
      // fetch(url, { mode: 'no-cors' }) from a pane
      { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'empty' },
      // new EventSource(url) from a pane
      { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', origin: 'https://h:10000' },
      // a link or window.open to the API
      { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
      // an older browser's CORS read: Origin alone
      { origin: 'https://evil.example' },
    ]) {
      for (const path of reads) {
        const res = await raw(port, { path, headers: { host, ...headers } })
        assert.equal(res.status, 403, `${path} ${JSON.stringify(headers)}`)
        assert.match(res.body, /cross-site request refused/)
      }
    }
    assert.deepEqual(hits, [])
    assert.equal(calls.some(x => x[0] === 'teardown' || x[0] === 'ensureBuilt' || x[0] === 'comment'), false, 'a refused request does nothing')

    // the harness page's own fetches, the operator's own navigation, and curl
    for (const headers of [
      { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
      { 'sec-fetch-site': 'none' },
      { origin: `http://${host}` },
      {},
    ]) {
      assert.equal((await post('/api/teardown', headers)).status, 200, JSON.stringify(headers))
      assert.equal((await raw(port, { path: '/qa/api/prs', headers: { host, ...headers } })).status, 200, JSON.stringify(headers))
    }
    assert.deepEqual(hits, ['listOpenPrs', 'listOpenPrs', 'listOpenPrs', 'listOpenPrs'])
    // the harness page at the harness origin's own host:port
    const own = { origin: 'https://h.ts.net:8444', host: 'h.ts.net:8444' }
    assert.equal((await raw(port, { method: 'POST', path: '/qa/api/session', body: '{"pr":7}', headers: { ...json, ...own } })).status, 202)
    // (the stream sends its headers with its first event, so a session runs)
    const stream = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/qa/api/progress', headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' } }, res => { res.destroy(); resolve(res) }).on('error', reject)
    })
    assert.equal(stream.statusCode, 200)
    // the page itself still opens from a link on any site
    for (const path of ['/qa', '/qa/harness.js']) {
      const res = await raw(port, { path, headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } })
      assert.equal(res.status, 200, path)
    }
  } finally { c.stop() }
})

// A page at another port of the harness's hostname is same-origin with the
// handler that served it. If that handler proxies to the harness too (a stale
// tailscale serve mount), only the host:port check keeps the page out.
test('a browser /api/* request whose Host is another port of the harness hostname gets 403 not the harness origin; loopback Hosts and curl pass', async () => {
  const { c, calls } = makeWorld()
  try {
    const port = await harnessPort(c)
    for (const host of ['h.ts.net:8446', 'h.ts.net', 'h:8443']) {
      for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { origin: `https://${host}` }]) {
        // the refusal names the harness origin, for the harness page's banner
        const read = await raw(port, { path: '/qa/api/state', headers: { host, ...headers } })
        assert.deepEqual([read.status, JSON.parse(read.body)], [403, { error: 'not the harness origin', harnessOrigin: 'https://h.ts.net:8444' }], `${host} ${JSON.stringify(headers)}`)
        const write = await raw(port, { method: 'POST', path: '/qa/api/teardown', body: '{}', headers: { host, 'content-type': 'application/json', ...headers } })
        assert.equal(write.status, 403, `${host} ${JSON.stringify(headers)}`)
      }
    }
    assert.equal(calls.some(x => x[0] === 'teardown'), false)
    // the harness origin itself
    assert.equal((await raw(port, { path: '/qa/api/state', headers: { host: 'h.ts.net:8444', 'sec-fetch-site': 'same-origin' } })).status, 200)
    assert.equal((await raw(port, { path: '/qa/api/state', headers: { host: 'H.TS.NET:8444', 'sec-fetch-site': 'same-origin' } })).status, 200)
    assert.equal((await raw(port, { path: '/qa/api/state', headers: { host: 'h.ts.net:8444', origin: 'https://h.ts.net:8444' } })).status, 200)
    // loopback Hosts: the harness opened at localhost, and nested demos
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
      assert.equal((await raw(port, { path: '/qa/api/state', headers: { host, 'sec-fetch-site': 'same-origin' } })).status, 200, host)
    }
    // curl through any handler
    assert.equal((await raw(port, { path: '/qa/api/state', headers: { host: 'h.ts.net:8446' } })).status, 200)
    // the page itself is not an API route
    assert.equal((await raw(port, { path: '/qa/', headers: { host: 'h.ts.net:8446', 'sec-fetch-site': 'none' } })).status, 200)
  } finally { c.stop() }
})

test('/api/state reports the harness origin', async () => {
  for (const [cfg, want] of [
    [{}, () => 'https://h.ts.net:8444'],
    [{ harnessOrigin: 'https://Q.example:8445/qa/' }, () => 'https://q.example:8445'],
    [{ publicHost: null }, port => `http://127.0.0.1:${port}`],
  ]) {
    const { c } = makeWorld({ cfg })
    try {
      const port = await harnessPort(c)
      assert.equal((await api(port, 'GET', '/api/state')).harnessOrigin, want(port), JSON.stringify(cfg))
    } finally { c.stop() }
  }
})

// A `::1` bind derives http://[::1]:<port>, and a CSP source can't name an
// IPv6 literal: no harness could frame the panes.
test('an IPv6-literal harness origin is logged as an error naming a localhost origin to use', async () => {
  const { c, logLines, errorLines } = makeWorld({ cfg: { harnessOrigin: 'http://[::1]:3100' } })
  try {
    const { base } = await allPorts(c)
    assert.ok(logLines.includes('[qa] harness at http://[::1]:3100/qa/'), logLines.join('\n'))
    assert.ok(
      errorLines.includes('[qa] the harness origin http://[::1]:3100 is an IPv6 literal, which frame-ancestors cannot name: the panes will stay blank; set QA_HARNESS_ORIGIN=http://localhost:3100'),
      errorLines.join('\n'),
    )
    assert.equal((await raw(base, { path: '/x' })).headers['content-security-policy'], "frame-ancestors 'self'")
  } finally { c.stop() }
})

// --- 0.3.0: frame locks ----------------------------------------------------------

const HARNESS_FRAME = { 'content-security-policy': "frame-ancestors 'self'", 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'strict-origin-when-cross-origin' }
const frameHeaders = res => Object.fromEntries(Object.keys(HARNESS_FRAME).map(k => [k, res.headers[k]]))

// The harness starts sessions and posts verdicts in one click, so a page that
// framed it could trick the operator into clicking (clickjacking). The
// Referrer-Policy keeps the harness origin in the Referer the panes check,
// whatever a browser's default.
test('every harness response forbids framing by other pages and sets the Referrer-Policy, 403s, 421s, 400s and errors included', async () => {
  const { c } = makeWorld()
  try {
    const port = await harnessPort(c)
    const cases = [
      [{ path: '/qa' }, 200],
      [{ path: '/qa/harness.js' }, 200],
      [{ path: '/qa/api/state' }, 200],
      [{ path: '/qa/api/build-status?pr=x' }, 400],
      [{ path: '/qa/api/verdict/preview?verdict=accept' }, 409],
      [{ path: '/qa/nope' }, 404],
      [{ method: 'POST', path: '/qa/api/teardown', headers: { 'sec-fetch-site': 'same-site' } }, 403],
      [{ path: '/qa/api/state', headers: { host: 'h.ts.net:8446', 'sec-fetch-site': 'same-origin' } }, 403],
      [{ method: 'POST', path: '/qa/api/teardown', headers: { 'content-type': 'text/plain' } }, 415],
      [{ method: 'POST', path: '/qa/api/session', body: '{}', headers: { 'content-type': 'application/json' } }, 400],
      [{ path: '/qa', headers: { host: 'attacker.example' } }, 421],
      [{ path: '//x:99999' }, 400],
    ]
    for (const [r, status] of cases) {
      const res = await raw(port, r)
      const label = `${r.method ?? 'GET'} ${r.path} ${JSON.stringify(r.headers ?? {})}`
      assert.equal(res.status, status, label)
      assert.deepEqual(frameHeaders(res), HARNESS_FRAME, label)
    }
    // the progress stream never ends (and sends its headers with the first
    // event): start a session, then check the stream's headers and hang up
    await api(port, 'POST', '/api/session', { pr: 7 })
    const stream = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/qa/api/progress' }, res => { res.destroy(); resolve(res) }).on('error', reject)
    })
    assert.equal(stream.headers['content-type'], 'text/event-stream')
    assert.deepEqual(frameHeaders(stream), HARNESS_FRAME)
  } finally { c.stop() }
})

test('a harness 500 forbids framing too', async () => {
  const { c, github } = makeWorld()
  try {
    const port = await harnessPort(c)
    github.listOpenPrs = async () => { throw new Error('github down') }
    const res = await raw(port, { path: '/qa/api/prs' })
    assert.equal(res.status, 500)
    assert.deepEqual(frameHeaders(res), HARNESS_FRAME)
  } finally { c.stop() }
})

// The pane proxies sign every request in as the operator, so they too must
// tell the pane's own pages from others, and only the harness may frame them
// (as its Referer shows: frame-ancestors stops only the render).
test('both panes refuse other pages\' writes and subresource loads, and only the harness, at the origin derived from its bound port, may frame them', async () => {
  const { c } = makeWorld({ cfg: { publicHost: null } })
  try {
    const { harness, base, pr } = await allPorts(c)
    const HARNESS = `http://127.0.0.1:${harness}`
    await api(harness, 'POST', '/api/session', { pr: 7 })
    await waitFor(async () => (await api(harness, 'GET', '/api/state')).status === 'ready')
    for (const port of [base, pr]) {
      const other = port === base ? pr : base
      for (const site of ['same-site', 'cross-site']) {
        const res = await raw(port, { method: 'POST', path: '/x', body: '{}', headers: { 'sec-fetch-site': site, origin: HARNESS } })
        assert.equal(res.status, 403, `${port} ${site}`)
        assert.doesNotMatch(res.body, /pane-/)
      }
      const own = await raw(port, { method: 'POST', path: '/x', body: '{}', headers: { 'sec-fetch-site': 'same-origin' } })
      assert.equal(own.status, 200)
      // another page's <img> or no-cors fetch, and another page's frame
      for (const headers of [
        { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' },
        { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'empty' },
        { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe', referer: `http://127.0.0.1:${other}/` },
        { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe', referer: `http://localhost:${harness}/` },
      ]) {
        const res = await raw(port, { path: '/page', headers })
        assert.equal(res.status, 403, `${port} ${JSON.stringify(headers)}`)
        assert.doesNotMatch(res.body, /pane-/)
        assert.equal(res.headers['content-security-policy'], `frame-ancestors 'self' ${HARNESS}`)
      }
      // the harness loading the pane in its iframe
      const page = await raw(port, {
        path: '/page',
        headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe', referer: `${HARNESS}/` },
      })
      assert.equal(page.status, 200)
      assert.equal(page.headers['content-security-policy'], `frame-ancestors 'self' ${HARNESS}`)
      assert.equal(page.headers['x-content-type-options'], 'nosniff')
      assert.match(page.body, new RegExp(`<script src="/__qa/bridge\\.js" data-harness="${HARNESS}"></script></head>pane-`))
    }
  } finally { c.stop() }
})

test('a derived harness origin frames the panes and is logged', async () => {
  const { c, logLines, errorLines } = makeWorld({ cfg: { publicHost: null, frameAncestors: ['https://outer.example:8444'] } })
  try {
    const { harness, base, pr } = await allPorts(c)
    const origin = `http://127.0.0.1:${harness}`
    assert.ok(logLines.includes(`[qa] harness at ${origin}/qa/`), logLines.join('\n'))
    for (const port of [base, pr]) {
      assert.equal((await raw(port, { path: '/x' })).headers['content-security-policy'], `frame-ancestors 'self' ${origin} https://outer.example:8444`)
    }
    assert.equal(errorLines.some(l => /harness origin/.test(l)), false, errorLines.join('\n'))
  } finally { c.stop() }
  // a configured origin is logged as it is
  const configured = makeWorld()
  try {
    await harnessPort(configured.c)
    assert.ok(configured.logLines.includes('[qa] harness at https://h.ts.net:8444/qa/'), configured.logLines.join('\n'))
  } finally { configured.c.stop() }
})

// Off loopback, with no public host and no harness origin (a hand-built cfg:
// loadConfig refuses this one), nothing can name the harness origin.
test('with no harness origin startup logs an error, /api/state reports null, and only a pane may frame itself', async () => {
  const { c, logLines, errorLines } = makeWorld({ cfg: { publicHost: null, host: '0.0.0.0' } })
  try {
    const { harness, base, pr } = await allPorts(c)
    assert.ok(
      errorLines.includes('[qa] no harness origin (set QA_HARNESS_ORIGIN): only a pane can frame itself and the mirror is off'),
      errorLines.join('\n'),
    )
    assert.equal(logLines.some(l => l.startsWith('[qa] harness at')), false, logLines.join('\n'))
    assert.equal((await api(harness, 'GET', '/api/state')).harnessOrigin, null)
    await api(harness, 'POST', '/api/session', { pr: 7 })
    await waitFor(async () => (await api(harness, 'GET', '/api/state')).status === 'ready')
    for (const port of [base, pr]) {
      const page = await raw(port, { path: '/page' })
      assert.equal(page.headers['content-security-policy'], "frame-ancestors 'self'")
      // the bridge gets no harness to talk to
      assert.match(page.body, /<script src="\/__qa\/bridge\.js"><\/script><\/head>pane-/)
      // and no Referer admits a navigation from another site
      for (const referer of [undefined, 'http://127.0.0.1:1/']) {
        const headers = { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe', ...(referer ? { referer } : {}) }
        assert.equal((await raw(port, { path: '/page', headers })).status, 403, String(referer))
      }
    }
  } finally { c.stop() }
})

test('a pane 421 carries the pane frame-ancestors', async () => {
  const { c } = makeWorld()
  try {
    const { base, pr } = await allPorts(c)
    for (const port of [base, pr]) {
      const res = await raw(port, { path: '/x', headers: { host: 'attacker.example' } })
      assert.equal(res.status, 421)
      assert.equal(res.headers['content-security-policy'], "frame-ancestors 'self' https://h.ts.net:8444")
      assert.equal(res.headers['x-content-type-options'], 'nosniff')
      assert.equal(res.headers['x-frame-options'], undefined)
    }
  } finally { c.stop() }
})

// --- 0.3.0: start-time origin checks ---------------------------------------------

// startConductor for a check that must throw before anything starts. Should
// a check regress, the conductor it starts is stopped at once, so the test
// fails instead of its servers and reaper holding the process open.
function startOnly(cfgOverrides, adapterOverrides = {}) {
  const c = startConductor({
    cfg: {
      publicHost: 'h.ts.net', ports: { harness: 0, base: 0, pr: 0 }, idleMinutes: 30,
      paneOrigins: { base: 'https://h:8443', pr: 'https://h:10000' }, verdictLabels: { accept: 'ok', reject: 'nope' },
      ...cfgOverrides,
    },
    github: {},
    fsx: {},
    adapters: { provisioner: { sweep: () => { throw new Error('ran') } }, build: {}, ...adapterOverrides },
    log: { log() {}, error() {} },
  })
  c.stop()
  return c
}

test('startConductor refuses a cfg.harnessOrigin or cfg.frameAncestors entry that is not an http(s) origin', () => {
  for (const bad of ['h.ts.net:8444', 'file:///x', 'data:text/html,x', '*', 'https://a;b', '', 42]) {
    assert.throws(() => startOnly({ harnessOrigin: bad }), /cfg\.harnessOrigin must be an origin/, String(bad))
    assert.throws(() => startOnly({ frameAncestors: ['https://ok.example', bad] }), /cfg\.frameAncestors must be an origin/, String(bad))
  }
  assert.throws(() => startOnly({ publicHost: 'h.ts.net;x' }), /must be an origin/)
})

// Browsers send Fetch Metadata only to https and loopback origins. Without it,
// another page's <img> or <iframe> GET carries neither Sec-Fetch-Site nor
// Origin, and the guards take it for curl.
test('startConductor refuses a plain-http harness or pane origin off loopback', async () => {
  assert.throws(() => startOnly({ harnessOrigin: 'http://box.lan:3100' }), /^Error: cfg\.harnessOrigin http:\/\/box\.lan:3100: browsers send no Sec-Fetch-\* headers .*the harness API guard/)
  assert.throws(() => startOnly({ paneOrigins: { base: 'http://box.lan:3101', pr: 'https://h:10000' } }), /^Error: cfg\.paneOrigins\.base http:\/\/box\.lan:3101: .*the pane request guard/)
  assert.throws(() => startOnly({ paneOrigins: { base: 'https://h:8443', pr: 'http://192.168.1.5:3102/' } }), /^Error: cfg\.paneOrigins\.pr http:\/\/192\.168\.1\.5:3102: /)
  // https anywhere, and http on loopback, start
  for (const cfg of [
    { harnessOrigin: 'https://box.lan:3100', paneOrigins: { base: 'https://box.lan:3101', pr: 'https://box.lan:3102' } },
    { publicHost: null, harnessOrigin: 'http://localhost:3100', paneOrigins: { base: 'http://127.0.0.1:3101', pr: 'http://[::1]:3102' } },
  ]) {
    const { c } = makeWorld({ cfg })
    try {
      assert.equal((await api(await harnessPort(c), 'GET', '/api/state')).status, 'idle', JSON.stringify(cfg))
    } finally { c.stop() }
  }
})

test('startConductor refuses a harness origin, explicit or derived from publicHost, equal to a pane origin; equal pane placeholders start', async () => {
  assert.throws(() => startOnly({ harnessOrigin: 'https://H:8443/qa/' }), /harness origin https:\/\/h:8443 is also the base pane's origin/)
  assert.throws(() => startOnly({ paneOrigins: { base: 'https://h:8443', pr: 'https://h.ts.net:8444/' } }), /harness origin https:\/\/h\.ts\.net:8444 is also the pr pane's origin/)
  // derived from a fixed loopback port
  assert.throws(() => startOnly({ publicHost: null, ports: { harness: 3100, base: 0, pr: 0 }, paneOrigins: { base: 'http://127.0.0.1:3100', pr: 'x' } }), /base pane/)

  // the demo's placeholders are equal until its proxies listen; an
  // unparseable pane origin is skipped here
  for (const paneOrigins of [{ base: 'http://127.0.0.1', pr: 'http://127.0.0.1' }, { base: 'not a url', pr: 'https://h:10000' }]) {
    const { c } = makeWorld({ cfg: { publicHost: null, paneOrigins } })
    try {
      const port = await harnessPort(c)
      assert.equal((await api(port, 'GET', '/api/state')).status, 'idle', JSON.stringify(paneOrigins))
    } finally { c.stop() }
  }
})

// --- 0.3.0: the Tailscale identity gate (#307) ------------------------------------

// tailscale serve in front, and the allowlist loadConfig requires there.
const GATED = { exposure: 'tailscale', allowedLogins: ['alice@github'] }
// What tailscale serve adds for a request from an allowed user's own device.
const ALLOWED = { 'tailscale-user-login': 'alice@github' }
const UPGRADE = { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' }
const LOOPBACK_PANES = { base: 'http://127.0.0.1:3101', pr: 'http://127.0.0.1:3102' }

test('the harness refuses every route without an allowed identity, leaking nothing', async () => {
  const { c, calls } = makeWorld({ cfg: GATED })
  try {
    const port = await harnessPort(c)
    const requests = [
      { path: '/qa' }, { path: '/qa/harness.js' }, { path: '/qa/api/state' }, { path: '/api/state' },
      { path: '/qa/api/prs' }, { path: '/qa/api/progress' }, { path: '/qa/api/verdict/preview?verdict=accept' },
      { path: '/qa/api/nope' },
      { method: 'POST', path: '/qa/api/session', headers: { 'content-type': 'application/json' }, body: '{"pr":7}' },
      { method: 'POST', path: '/qa/api/verdict', headers: { 'content-type': 'application/json' }, body: '{"verdict":"accept"}' },
      { method: 'POST', path: '/qa/api/teardown' },
      { path: '/qa/api/state', headers: UPGRADE },
      // before the Host check and the URL parse, too
      { path: '/qa/api/state', headers: { host: 'attacker.example' } },
      { path: '//x:99999' },
    ]
    for (const identity of [{}, { 'tailscale-user-login': 'mallory@github' }]) {
      for (const r of requests) {
        const res = await raw(port, { ...r, headers: { ...r.headers, ...identity } })
        assert.equal(res.status, 403, `${r.method ?? 'GET'} ${r.path} ${JSON.stringify(identity)}`)
        assert.match(res.headers['content-type'], /^text\/plain/)
        assert.doesNotMatch(res.body, /login-|status|idle|ok|nope/)
      }
    }
    // nothing ran on the refused writes
    assert.equal((await api(port, 'GET', '/api/state', undefined, ALLOWED)).status, 'idle')
    assert.deepEqual(calls.filter(x => !x[0].startsWith('sweep')), [])
  } finally { c.stop() }
})

test('both pane proxies refuse every route, the bridge and upgrades without an allowed identity', async () => {
  const { c } = makeWorld({ cfg: GATED })
  try {
    const { harness, base, pr } = await allPorts(c)
    await api(harness, 'POST', '/api/session', { pr: 7 }, ALLOWED)
    await waitFor(async () => (await api(harness, 'GET', '/api/state', undefined, ALLOWED)).status === 'ready')
    for (const port of [base, pr]) {
      for (const identity of [{}, { 'tailscale-user-login': 'mallory@github' }]) {
        for (const r of [{ path: '/x' }, { path: '/__qa/bridge.js' }, { method: 'POST', path: '/api/x', body: '{}' }, { path: '/x', headers: UPGRADE }, { path: '/x', headers: { host: 'attacker.example' } }]) {
          const res = await raw(port, { ...r, headers: { ...r.headers, ...identity } })
          assert.equal(res.status, 403, `${port} ${r.path} ${JSON.stringify(identity)}`)
          assert.doesNotMatch(res.body, /pane-|bridge/)
        }
      }
    }
    assert.equal((await raw(base, { path: '/x', headers: ALLOWED })).body, 'pane-base')
    assert.equal((await raw(pr, { path: '/x', headers: ALLOWED })).body, 'pane-pr')
  } finally { c.stop() }
})

test('an allowed identity is served on all three, matched ignoring case', async () => {
  const { c } = makeWorld({ cfg: { ...GATED, allowedLogins: ['bob@homefree.local', 'Alice@github '] } })
  try {
    const { harness, base, pr } = await allPorts(c)
    const res = await raw(harness, { path: '/qa/api/state', headers: { 'tailscale-user-login': 'Alice@GitHub' } })
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(res.body).status, 'idle')
    assert.equal((await raw(base, { path: '/x', headers: { 'tailscale-user-login': 'bob@homefree.local' } })).status, 503)
    assert.equal((await raw(pr, { path: '/x', headers: { 'tailscale-user-login': 'BOB@homefree.local' } })).status, 503)
  } finally { c.stop() }
})

// tailscale serve stamps every request from the reviewer's device with the
// reviewer's login, those PR code makes in the reviewer's browser included.
// The gate says which device; only the API guard, the Host allowlist and the
// pane guard say which page, so an allowed identity must not skip them
// (D10; homefree #329's 'harness writes from another origin are refused even
// with an allowed identity').
test('with an allowed identity, another page\'s writes, a foreign Host, another host:port and a cross-site pane navigation are still refused', async () => {
  const { c, calls } = makeWorld({ cfg: GATED })
  try {
    const { harness, base, pr } = await allPorts(c)
    const session = headers => raw(harness, {
      method: 'POST', path: '/qa/api/session', body: '{"pr":7}', headers: { 'content-type': 'application/json', ...ALLOWED, ...headers },
    })
    // a pane's page, another site, and a page whose Origin isn't a URL
    for (const headers of [
      { 'sec-fetch-site': 'same-site', origin: 'https://h:10000' },
      { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      { origin: 'not a url' },
    ]) {
      const res = await session(headers)
      assert.deepEqual([res.status, JSON.parse(res.body)], [403, { error: 'cross-site request refused' }], JSON.stringify(headers))
    }
    // a page at another port of the harness hostname
    for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { origin: 'https://h.ts.net:9999' }]) {
      const res = await session({ host: 'h.ts.net:9999', ...headers })
      assert.deepEqual([res.status, JSON.parse(res.body).error], [403, 'not the harness origin'], JSON.stringify(headers))
    }
    assert.equal(calls.some(x => x[0] === 'ensureBuilt'), false, 'a refused write starts no boot')
    // a DNS-rebound page, on all three servers
    for (const port of [harness, base, pr]) {
      assert.equal((await raw(port, { path: '/qa/api/state', headers: { ...ALLOWED, host: 'attacker.example' } })).status, 421, String(port))
    }

    // the harness page itself starts the session
    assert.equal((await session({ host: 'h.ts.net:8444', 'sec-fetch-site': 'same-origin' })).status, 202)
    await waitFor(async () => (await api(harness, 'GET', '/api/state', undefined, ALLOWED)).status === 'ready')
    const navigate = { ...ALLOWED, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }
    for (const port of [base, pr]) {
      // a link or window.open on another site, which the harness did not make
      for (const referer of [undefined, 'https://evil.example/']) {
        const res = await raw(port, { path: '/page', headers: { ...navigate, ...(referer ? { referer } : {}) } })
        assert.equal(res.status, 403, `${port} ${referer}`)
        assert.match(res.body, /cross-site navigation refused/)
        assert.doesNotMatch(res.body, /pane-/)
      }
      // the harness opening the pane
      assert.equal((await raw(port, { path: '/page', headers: { ...navigate, referer: 'https://h.ts.net:8444/qa/' } })).status, 200, String(port))
    }
  } finally { c.stop() }
})

const EMPTY_LOGINS = "[qa] QA_ALLOWED_LOGINS is empty: every request will be refused; set cfg.allowedLogins, or exposure: 'none' if another front door authenticates"

test('with no allowed logins every request is refused, and startup says so', async () => {
  for (const allowedLogins of [[], undefined, [' ']]) {
    const { c, errorLines } = makeWorld({ cfg: { ...GATED, allowedLogins } })
    try {
      const { harness, base, pr } = await allPorts(c)
      for (const port of [harness, base, pr]) assert.equal((await raw(port, { path: '/', headers: ALLOWED })).status, 403)
      assert.ok(errorLines.includes(EMPTY_LOGINS), errorLines.join('\n'))
    } finally { c.stop() }
  }
})

test('refused requests do not count as pane activity', async () => {
  const { c } = makeWorld({ cfg: GATED })
  try {
    const { harness, base } = await allPorts(c)
    const before = (await api(harness, 'GET', '/api/state', undefined, ALLOWED)).lastActivity
    await new Promise(r => setTimeout(r, 5))
    assert.equal((await raw(base, { path: '/x' })).status, 403)
    assert.equal((await api(harness, 'GET', '/api/state', undefined, ALLOWED)).lastActivity, before)
  } finally { c.stop() }
})

// Is a request with no Tailscale identity served? On all three servers alike.
async function gated(c) {
  const ports = Object.values(await allPorts(c))
  const statuses = []
  for (const port of ports) statuses.push((await raw(port, { path: '/qa/api/state' })).status)
  assert.equal(new Set(statuses.map(s => s === 403)).size, 1, `all three agree: ${statuses}`)
  return statuses[0] === 403
}

// A cfg built in code, with no `exposure`, resolves the mode as loadConfig
// does: any address it answers to or listens on that is off loopback means
// it is meant to be reached from another machine.
test('a cfg without exposure is gated when an origin is not loopback and not when all are', async () => {
  const loopback = { exposure: undefined, publicHost: null, paneOrigins: LOOPBACK_PANES, allowedLogins: ['alice@github'] }
  for (const [cfg, want] of [
    [loopback, false],
    [{ ...loopback, harnessOrigin: 'http://localhost:3100', allowedHosts: ['localhost'] }, false],
    [{ ...loopback, harnessOrigin: 'https://h.ts.net:8444' }, true],
    [{ ...loopback, paneOrigins: { ...LOOPBACK_PANES, pr: 'https://h.ts.net:10000' } }, true],
    [{ ...loopback, paneOrigins: { pr: LOOPBACK_PANES.pr } }, true],
    [{ ...loopback, paneOrigins: { ...LOOPBACK_PANES, base: 'not yet' } }, true],
    [{ ...loopback, allowedHosts: ['box.ts.net'] }, true],
    // makeWorld's https layout
    [{ exposure: undefined, allowedLogins: ['alice@github'] }, true],
  ]) {
    const { c } = makeWorld({ cfg })
    try {
      assert.equal(await gated(c), want, JSON.stringify(cfg))
    } finally { c.stop() }
  }
})

test('a cfg without exposure, with publicHost and loopback pane origins, is gated (the derived harness origin counts)', async () => {
  const { c } = makeWorld({ cfg: { exposure: undefined, publicHost: 'h.ts.net', paneOrigins: LOOPBACK_PANES, allowedLogins: ['alice@github'] } })
  try {
    assert.equal(await gated(c), true)
    const { harness } = await allPorts(c)
    assert.equal((await api(harness, 'GET', '/api/state', undefined, ALLOWED)).harnessOrigin, 'https://h.ts.net:8444')
  } finally { c.stop() }
})

test('tailscale mode on a non-loopback host, or an unknown mode, refuses to start', async () => {
  const loopback = { publicHost: null, paneOrigins: LOOPBACK_PANES, harnessOrigin: 'http://127.0.0.1:3100', allowedLogins: ['alice@github'] }
  for (const [cfg, why] of [
    [{ ...loopback, exposure: 'tailscale', host: '0.0.0.0' }, "cfg.exposure is 'tailscale'"],
    // a non-loopback bind alone makes the default tailscale
    [{ ...loopback, host: '0.0.0.0' }, 'exposure defaults to tailscale because QA_BIND_HOST=0.0.0.0 is not loopback'],
    [{ ...loopback, host: '::' }, 'exposure defaults to tailscale because QA_BIND_HOST=:: is not loopback'],
    [{ host: '192.168.1.5', allowedLogins: ['alice@github'] }, 'exposure defaults to tailscale because QA_PUBLIC_HOST=h.ts.net is not loopback'],
  ]) {
    assert.throws(() => startOnly(cfg), err => {
      assert.ok(err.message.startsWith(`startConductor: ${why}, so cfg.host must be a loopback address: tailscale serve on this host is the only supported front (got ${JSON.stringify(cfg.host)})`), err.message)
      assert.ok(err.message.endsWith(", or set exposure: 'none' if another front door authenticates"), err.message)
      return true
    }, JSON.stringify(cfg))
  }
  for (const exposure of ['Tailscale', 'off', '', 0, true, {}]) {
    assert.throws(() => startOnly({ ...loopback, exposure }), /^Error: startConductor: cfg\.exposure must be 'none' or 'tailscale', got /, JSON.stringify(exposure))
  }
  // none mode still binds anywhere (behind another front door), and
  // tailscale mode any loopback address (not 127.0.0.2: macOS has only .1)
  for (const [cfg, want] of [[{ exposure: 'none', host: '0.0.0.0' }, ['0.0.0.0']], [{ ...GATED, host: 'localhost' }, ['127.0.0.1', '::1']]]) {
    const { c } = makeWorld({ cfg })
    try {
      await harnessPort(c)
      assert.ok(want.includes(c.servers.harness.address().address), JSON.stringify(cfg))
    } finally { c.stop() }
  }
})

// `[::1]` passed the tailscale bind check as loopback, then listen() failed
// with ENOTFOUND, which nothing handled: the process crashed.
test('a bracketed cfg.host refuses to start, in either mode', () => {
  for (const cfg of [GATED, { exposure: 'none' }, { exposure: undefined }, { publicHost: null, paneOrigins: LOOPBACK_PANES, ports: { harness: 3100, base: 0, pr: 0 } }]) {
    for (const [host, bare] of [['[::1]', '::1'], ['[::]', '::']]) {
      assert.throws(
        () => startOnly({ ...cfg, host }),
        { message: `startConductor: cfg.host is a listen address, which takes an IPv6 literal without brackets: use "${bare}", not "${host}"` },
        `${host} ${JSON.stringify(cfg)}`,
      )
    }
  }
})

test('the identity 403 carries the harness frame headers on the harness, and the pane policy on each pane', async () => {
  const { c } = makeWorld({ cfg: GATED })
  try {
    const { harness, base, pr } = await allPorts(c)
    for (const path of ['/qa', '/qa/api/state']) {
      const res = await raw(harness, { path })
      assert.equal(res.status, 403)
      assert.deepEqual(frameHeaders(res), HARNESS_FRAME, path)
      assert.equal(res.headers['cache-control'], 'no-store')
    }
    for (const port of [base, pr]) {
      const res = await raw(port, { path: '/x' })
      assert.equal(res.status, 403)
      assert.equal(res.headers['content-security-policy'], "frame-ancestors 'self' https://h.ts.net:8444")
      assert.equal(res.headers['x-content-type-options'], 'nosniff')
      assert.equal(res.headers['x-frame-options'], undefined)
    }
  } finally { c.stop() }
})

test('startup says whether the gate is on', async () => {
  for (const [cfg, logged, errored] of [
    [GATED, '[qa] identity gate on: 1 allowed login', null],
    [{ ...GATED, allowedLogins: ['alice@github', 'bob@github', ''] }, '[qa] identity gate on: 2 allowed logins', null],
    [{ ...GATED, allowedLogins: [] }, '[qa] identity gate on: 0 allowed logins', EMPTY_LOGINS],
    [{}, '[qa] identity gate off (QA_EXPOSURE=none)', null],
    [{ exposure: undefined, publicHost: null, paneOrigins: LOOPBACK_PANES }, '[qa] identity gate off (QA_EXPOSURE=none)', null],
    // a defaulted mode says why, a pane origin left unset at start included
    [
      { exposure: undefined, publicHost: null, paneOrigins: { pr: LOOPBACK_PANES.pr } },
      '[qa] identity gate on (exposure defaults to tailscale because QA_BASE_ORIGIN (unset) is not loopback): 0 allowed logins', EMPTY_LOGINS,
    ],
    [
      { exposure: undefined, allowedLogins: ['alice@github'] },
      '[qa] identity gate on (exposure defaults to tailscale because QA_PUBLIC_HOST=h.ts.net is not loopback): 1 allowed login', null,
    ],
  ]) {
    const { c, logLines, errorLines } = makeWorld({ cfg })
    try {
      await allPorts(c)
      assert.ok(logLines.includes(logged), `${JSON.stringify(cfg)}\n${logLines.join('\n')}`)
      assert.equal(logLines.filter(l => l.startsWith('[qa] identity gate')).length, 1, logLines.join('\n'))
      assert.deepEqual(errorLines.filter(l => /QA_ALLOWED_LOGINS/.test(l)), errored ? [errored] : [], JSON.stringify(cfg))
    } finally { c.stop() }
  }
})

test('POST /api/session, /api/verdict and /api/teardown require application/json (else 415)', async () => {
  const { c, calls } = makeWorld()
  try {
    const port = await harnessPort(c)
    const post = (path, contentType, body = '{}') => raw(port, { method: 'POST', path, headers: contentType ? { 'content-type': contentType } : {}, body })
    for (const path of ['/api/session', '/api/verdict', '/api/teardown', '/qa/api/teardown']) {
      for (const type of [null, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp']) {
        assert.equal((await post(path, type)).status, 415, `${path} ${type}`)
      }
    }
    assert.equal(calls.some(x => x[0] === 'teardown' || x[0] === 'ensureBuilt'), false)
    assert.equal((await post('/api/teardown', 'Application/JSON; charset=utf-8')).status, 200)
    assert.equal((await post('/api/session', 'application/json', JSON.stringify({ pr: 7 }))).status, 202)
  } finally { c.stop() }
})

// --- 0.2.0: generic build progress ----------------------------------------------

test('a build progress message reaches SSE and /api/state', async () => {
  const hang = { 7: deferred() }
  const { c, adapters } = makeWorld({ hang })
  let notify = null
  adapters.build.subscribeBuild = cb => { notify = cb }
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await waitFor(() => notify)
    notify({ message: 'installing dependencies for #7 (abc1234)…' })
    const events = await sseEvents(port, evs => evs.some(e => e.kind === 'build'))
    const ev = events.find(e => e.kind === 'build')
    assert.deepEqual({ ...ev, at: undefined }, { at: undefined, kind: 'build', runUrl: null, runStatus: null, message: 'installing dependencies for #7 (abc1234)…' })
    assert.deepEqual((await api(port, 'GET', '/api/state')).buildRun, { url: null, status: null, message: 'installing dependencies for #7 (abc1234)…' })

    notify({ runUrl: 'https://github.com/acme/widget/actions/runs/1', runStatus: 'in_progress' })
    assert.deepEqual((await api(port, 'GET', '/api/state')).buildRun, { url: 'https://github.com/acme/widget/actions/runs/1', status: 'in_progress', message: null })
  } finally { c.stop() }
})

// --- 0.2.0: blocked readiness ---------------------------------------------------

test('/api/prs passes a blocked reason through', async () => {
  const { c, adapters } = makeWorld()
  try {
    const port = await harnessPort(c)
    adapters.build.describePrs = async prs => prs.map(p => ({ number: p.number, status: 'blocked', reason: "head branch is in @eve's fork (eve/widget), not the author's", runUrl: null }))
    const row = (await api(port, 'GET', '/api/prs')).prs[0]
    assert.equal(row.imageStatus, 'blocked')
    assert.equal(row.reason, "head branch is in @eve's fork (eve/widget), not the author's")
  } finally { c.stop() }
})

test('/api/build-status uses github.prInfo when available and adds reason only when blocked', async () => {
  const { c, adapters, github } = makeWorld()
  github.prInfo = async num => ({
    number: num, headSha: 'abc', author: 'eve', authorAssociation: 'CONTRIBUTOR', isDraft: false, headRepo: 'eve/widget', headOwner: 'eve',
  })
  try {
    const port = await harnessPort(c)
    let seen = null
    adapters.build.describePrs = async prs => { seen = prs; return [{ number: 7, status: 'blocked', reason: 'not trusted', runUrl: null }] }
    assert.deepEqual(await api(port, 'GET', '/api/build-status?pr=7'), { pr: 7, status: 'blocked', exists: false, runUrl: null, reason: 'not trusted' })
    assert.deepEqual(seen, [{ number: 7, headSha: 'abc', author: 'eve', authorAssociation: 'CONTRIBUTOR', headRepo: 'eve/widget', headOwner: 'eve' }])

    adapters.build.describePrs = async () => [{ number: 7, status: 'built', reason: 'ignored', runUrl: null }]
    assert.deepEqual(await api(port, 'GET', '/api/build-status?pr=7'), { pr: 7, status: 'built', exists: true, runUrl: null })
  } finally { c.stop() }
})

// --- 0.2.0: failure log tails ---------------------------------------------------

test('err.logTail reaches the SSE error event (pane stage and build stage)', async () => {
  const pane = makeWorld({ failAt: 'launchServices' })
  try {
    const port = await harnessPort(pane.c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    const events = await sseEvents(port, evs => evs.some(e => e.kind === 'error'))
    const err = events.find(e => e.kind === 'error')
    assert.deepEqual([err.step, err.message, err.logTail], ['starting', 'launch failed', 'tail-lines'])
  } finally { pane.c.stop() }

  const build = makeWorld()
  build.adapters.build.ensureBuilt = async () => {
    throw Object.assign(new Error('install failed for #7 (abc1234): pnpm exited 1'), { logTail: 'ERR_PNPM_FETCH_404' })
  }
  try {
    const port = await harnessPort(build.c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    const events = await sseEvents(port, evs => evs.some(e => e.kind === 'error'))
    const err = events.find(e => e.kind === 'error')
    assert.deepEqual([err.step, err.logTail], ['ensuring-image', 'ERR_PNPM_FETCH_404'])
    assert.equal(build.calls.some(x => x[0] === 'logs'), false)
  } finally { build.c.stop() }
})

// A readBaseEnv failure leaves no role, so bootSession attaches no tail and the
// server asks the Provisioner itself. logs() may be synchronous.
test('the fallback log tail tolerates a synchronous logs(), returning or throwing', async () => {
  const cases = [
    [() => 'tail', 'tail'],
    [() => { throw new Error('container gone') }, ''],
    [() => ({ not: 'a string' }), ''],
  ]
  for (const [logs, want] of cases) {
    const w = makeWorld({ readBaseEnv: async () => { throw new Error('x') } })
    w.adapters.provisioner.logs = logs
    try {
      const port = await harnessPort(w.c)
      await api(port, 'POST', '/api/session', { pr: 7 })
      const events = await sseEvents(port, evs => evs.some(e => e.kind === 'error'))
      const err = events.find(e => e.kind === 'error')
      assert.deepEqual([err.step, err.message, err.logTail], ['migrating', 'x', want])
      assert.equal((await api(port, 'GET', '/api/state')).status, 'error', 'the harness is still up')
    } finally { w.c.stop() }
  }
})

// --- 0.2.0: shutdown -------------------------------------------------------------

test('shutdown() aborts the boot, tears down both panes, ends SSE and closes all three servers', async () => {
  const hang = { 9: deferred() }
  const { conductor, closeApps, calls } = makeWorld({ hang })
  try {
    const port = await proxyPort(conductor.servers.harness)
    for (const s of [conductor.servers.baseProxy, conductor.servers.prProxy]) await proxyPort(s)
    await api(port, 'POST', '/api/session', { pr: 9 })
    await waitFor(() => calls.some(x => x[0] === 'ensureBuilt' && x[1] === 9))

    // an open SSE client must not hold the harness open
    const res = await fetch(`http://127.0.0.1:${port}/api/progress`)
    const reader = res.body.getReader()
    await reader.read()

    await conductor.shutdown()
    assert.deepEqual(calls.filter(x => x[0] === 'teardown').map(x => x[1]), ['base', 'pr'])
    for (const name of ['harness', 'baseProxy', 'prProxy']) assert.equal(conductor.servers[name].listening, false, name)
    for (;;) {
      const ended = await reader.read().then(r => r.done, () => true)
      if (ended) break
    }
    // the aborted boot's late failure is ignored; a second shutdown is a no-op
    hang[9].reject(new Error('late'))
    await conductor.shutdown()
    assert.equal(calls.filter(x => x[0] === 'teardown').length, 2)
  } finally { closeApps() }
})

// Regression: a POST accepted while shutdown() awaited the (slow) teardown
// started a boot that nothing aborted, provisioning after the servers closed.
test('once shutdown() begins, writes get 503 and no boot starts', async () => {
  const { conductor, closeApps, calls, adapters } = makeWorld()
  adapters.provisioner.teardown = async ({ paneRef }) => {
    calls.push(['teardown', paneRef.role])
    await new Promise(r => setTimeout(r, 100))
  }
  try {
    const port = await proxyPort(conductor.servers.harness)
    for (const s of [conductor.servers.baseProxy, conductor.servers.prProxy]) await proxyPort(s)
    const done = conductor.shutdown()
    await waitFor(() => calls.some(x => x[0] === 'teardown'))
    const post = await raw(port, { method: 'POST', path: '/api/session', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pr: 7 }) })
    assert.equal(post.status, 503)
    assert.equal((await raw(port, { path: '/api/state' })).status, 200, 'reads still answer')
    await done
    await new Promise(r => setTimeout(r, 50))
    assert.equal(calls.some(x => x[0] === 'ensureBuilt'), false, 'no boot after shutdown')
  } finally { closeApps() }
})

test('a takeover whose teardown overlaps shutdown() starts no boot', async () => {
  const { conductor, closeApps, calls, adapters } = makeWorld()
  try {
    const port = await proxyPort(conductor.servers.harness)
    for (const s of [conductor.servers.baseProxy, conductor.servers.prProxy]) await proxyPort(s)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'ready')
    adapters.provisioner.teardown = async ({ paneRef }) => {
      calls.push(['teardown', paneRef.role])
      await new Promise(r => setTimeout(r, 100))
    }
    const takeover = raw(port, { method: 'POST', path: '/api/session', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pr: 8, takeover: true }) })
    await waitFor(() => calls.some(x => x[0] === 'teardown'))
    await conductor.shutdown()
    assert.equal((await takeover).status, 503)
    await new Promise(r => setTimeout(r, 50))
    assert.deepEqual(calls.filter(x => x[0] === 'ensureBuilt').map(x => x[1]), [7], 'the takeover never booted')
  } finally { closeApps() }
})

test('shutdown() right after start still closes every server', async () => {
  const { conductor, closeApps } = makeWorld()
  try {
    await conductor.shutdown()
    await new Promise(r => setTimeout(r, 20))
    for (const name of ['harness', 'baseProxy', 'prProxy']) assert.equal(conductor.servers[name].listening, false, name)
  } finally { closeApps() }
})

// --- 0.2.1: boots wait for the startup sweep ------------------------------------

// A restart mid-session leaves orphans, which the startup sweep removes (the
// docker Provisioner: every labelled container, then the network). A boot that
// raced it could have its fresh containers and network removed mid-boot.
const WAITING = 'waiting for startup cleanup…'
const buildMessages = events => events.filter(e => e.kind === 'build').map(e => e.message)

test('a boot waits for the startup sweep before building or provisioning', async () => {
  const sweepGate = deferred()
  const { c, calls } = makeWorld({ sweepGate })
  try {
    const port = await harnessPort(c)
    await waitFor(() => calls.some(x => x[0] === 'sweep'))
    assert.deepEqual(await api(port, 'POST', '/api/session', { pr: 7 }), { ok: true })
    await new Promise(r => setTimeout(r, 50))
    assert.equal(calls.some(x => x[0] === 'ensureBuilt' || x[0] === 'provisionDatabase'), false, 'nothing runs before the sweep settles')
    assert.equal((await api(port, 'GET', '/api/state')).status, 'ensuring-image')

    sweepGate.resolve()
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'ready')
    const order = calls.map(x => x[0])
    assert.ok(order.indexOf('sweep-done') < order.indexOf('ensureBuilt'))
    assert.ok(order.indexOf('sweep-done') < order.indexOf('provisionDatabase'))
  } finally { c.stop() }
})

test('a failed startup sweep is logged and the boot waiting on it still reaches ready', async () => {
  const sweepGate = deferred()
  const { c, errorLines } = makeWorld({ sweepGate, sweepFails: true })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    sweepGate.resolve() // the sweep now rejects
    const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'ready' && s })
    assert.equal(st.error, null)
    assert.ok(errorLines.some(l => l.includes('startup sweep failed') && l.includes('docker unavailable')))

    await api(port, 'POST', '/api/teardown')
    await api(port, 'POST', '/api/session', { pr: 7 })
    const second = await sseEvents(port, evs => evs.some(e => e.kind === 'ready'))
    assert.deepEqual(buildMessages(second), [], 'a failed sweep is settled: later boots show no cleanup message')
  } finally { c.stop() }
})

test('a sweep that rejects with a non-Error is logged and blocks no boot', async () => {
  const sweepGate = deferred()
  const { c, errorLines } = makeWorld({ provisioner: { sweep: async () => { await sweepGate.promise; throw undefined } } })
  const settled = async port => waitFor(async () => {
    const s = await api(port, 'GET', '/api/state')
    return (s.status === 'ready' || s.status === 'error') && s
  })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    sweepGate.resolve() // the sweep now rejects, with a boot waiting on it
    const st = await settled(port)
    assert.deepEqual([st.status, st.error], ['ready', null])
    assert.ok(errorLines.some(l => l.includes('startup sweep failed: undefined')))

    await api(port, 'POST', '/api/teardown')
    await api(port, 'POST', '/api/session', { pr: 7 })
    const second = await settled(port)
    assert.deepEqual([second.status, second.error], ['ready', null], 'later boots are not blocked either')
  } finally { c.stop() }
})

test('a sweep that throws synchronously neither stops the conductor nor blocks boots', async () => {
  const { c, errorLines } = makeWorld({ provisioner: { sweep: () => { throw new Error('no docker socket') } } })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await waitFor(async () => (await api(port, 'GET', '/api/state')).status === 'ready')
    assert.ok(errorLines.some(l => l.includes('startup sweep failed') && l.includes('no docker socket')))
  } finally { c.stop() }
})

test('a teardown while a boot waits for the sweep leaves the session idle; the boot never resumes', async () => {
  const sweepGate = deferred()
  const { c, calls } = makeWorld({ sweepGate })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    await api(port, 'POST', '/api/teardown')
    assert.equal((await api(port, 'GET', '/api/state')).status, 'idle')

    sweepGate.resolve()
    await waitFor(() => calls.some(x => x[0] === 'sweep-done'))
    await new Promise(r => setTimeout(r, 50))
    const st = await api(port, 'GET', '/api/state')
    assert.deepEqual([st.status, st.pr, st.error, st.buildRun], ['idle', null, null, null])
    assert.equal(calls.some(x => x[0] === 'ensureBuilt' || x[0] === 'provisionDatabase'), false)
    const events = await sseEvents(port, evs => evs.some(e => e.kind === 'torn-down'))
    assert.deepEqual(buildMessages(events), [WAITING], 'no cleanup-done message for a torn-down boot')
  } finally { c.stop() }
})

test('a takeover while a boot waits for the sweep boots only the new PR', async () => {
  const sweepGate = deferred()
  const { c, calls } = makeWorld({ sweepGate })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 1 })
    assert.deepEqual(await api(port, 'POST', '/api/session', { pr: 2, takeover: true }), { ok: true })
    sweepGate.resolve()
    const st = await waitFor(async () => { const s = await api(port, 'GET', '/api/state'); return s.status === 'ready' && s })
    assert.deepEqual([st.pr, st.prTag], [2, 'img:pr-2'])
    await new Promise(r => setTimeout(r, 50))
    assert.deepEqual(calls.filter(x => x[0] === 'ensureBuilt').map(x => x[1]), [2], 'the taken-over boot never resumed')
  } finally { c.stop() }
})

test('with no provisioner.sweep a boot starts at once, with no cleanup message', async () => {
  const { c, calls, logLines } = makeWorld({ provisioner: { sweep: undefined } })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    assert.ok(calls.some(x => x[0] === 'ensureBuilt'), 'the boot was building before POST /api/session answered')
    const events = await sseEvents(port, evs => evs.some(e => e.kind === 'ready'))
    assert.deepEqual(buildMessages(events), [])
    assert.equal(logLines.some(l => l.includes('sweep')), false)
  } finally { c.stop() }
})

test('the harness shows the sweep wait only while the sweep is pending', async () => {
  const sweepGate = deferred()
  const { c } = makeWorld({ sweepGate })
  try {
    const port = await harnessPort(c)
    await api(port, 'POST', '/api/session', { pr: 7 })
    const waiting = await sseEvents(port, evs => evs.some(e => e.kind === 'build'))
    const ev = waiting.find(e => e.kind === 'build')
    assert.deepEqual({ ...ev, at: undefined }, { at: undefined, kind: 'build', runUrl: null, runStatus: null, message: WAITING })
    assert.deepEqual((await api(port, 'GET', '/api/state')).buildRun, { url: null, status: null, message: WAITING })

    // once the sweep settles the message is replaced before the boot moves on
    sweepGate.resolve()
    const first = await sseEvents(port, evs => evs.some(e => e.kind === 'ready'))
    assert.deepEqual(buildMessages(first), [WAITING, 'startup cleanup done'])
    const seq = first.map(e => (e.kind === 'step' ? e.step : e.message ?? e.kind))
    assert.ok(seq.indexOf('startup cleanup done') < seq.indexOf('cloning'))
    // one ensuring-image step: the harness times the step and the boot from it
    assert.equal(first.filter(e => e.kind === 'step' && e.step === 'ensuring-image').length, 1)

    // the sweep has settled: a later boot shows no cleanup message at all
    await api(port, 'POST', '/api/teardown')
    await api(port, 'POST', '/api/session', { pr: 7 })
    const second = await sseEvents(port, evs => evs.some(e => e.kind === 'ready'))
    assert.deepEqual(buildMessages(second), [])
    assert.equal((await api(port, 'GET', '/api/state')).buildRun, null)
  } finally { c.stop() }
})

// --- 0.3.0: the exposure reconcile loop ------------------------------------------

// A fake Exposure adapter. By default `ensure` writes every mount it is given
// and `check` finds nothing drifted; a test passes its own to script a pass,
// each called with the mounts and the pass number (1 for the first ensure).
// `calls` records each call with its mounts and, for ensure, whether all
// three servers were listening by then.
function fakeExposure({ ensure = mounts => ({ added: mounts, ok: [] }), check = () => ({ ok: true, drift: [] }) } = {}) {
  const fake = {
    calls: [],
    servers: null, // set by makeWorld
    ensures: () => fake.calls.filter(([fn]) => fn === 'ensure').length,
    ensure: async mounts => {
      fake.calls.push(['ensure', mounts, fake.servers !== null && Object.values(fake.servers).every(s => s.listening)])
      return ensure(mounts, fake.ensures())
    },
    check: async mounts => {
      fake.calls.push(['check', mounts])
      return check(mounts, fake.ensures())
    },
  }
  return fake
}

// The mounts makeWorld's layout declares: the harness at the origin derived
// from its public host, each pane at its own origin, all on the bound ports.
function mountsAt(ports) {
  const target = port => `http://127.0.0.1:${port}`
  return [
    { name: 'harness', host: 'h.ts.net', port: 8444, path: '/qa', target: target(ports.harness) },
    { name: 'base', host: 'h', port: 8443, path: '/', target: target(ports.base) },
    { name: 'pr', host: 'h', port: 10000, path: '/', target: target(ports.pr) },
  ]
}

const exposureLines = lines => lines.filter(l => l.startsWith('[qa] exposure'))
const mountedLine = (verb, m) => `[qa] exposure ${verb} ${m.port}${m.path} -> ${m.target}`
const UNMANAGED = { managed: false, ok: null, checkedAt: null, drift: [], added: [], error: null }
const MANAGED_OUTSIDE = '[qa] exposure: tailscale serve mounts are managed outside the conductor'

test('the first reconcile runs after all three servers listen: harness 8444 /qa, base 8443 /, pr 10000 /, targets on the bound ports', async t => {
  // On an IP host all three bind within a tick of each other, so hold the
  // last one (the PR pane proxy; makeWorld's two apps listen first) back.
  const listen = net.Server.prototype.listen
  let n = 0
  t.mock.method(net.Server.prototype, 'listen', function (...args) {
    if (++n !== 5) return listen.apply(this, args)
    setTimeout(() => listen.apply(this, args), 50)
    return this
  })
  const exposure = fakeExposure()
  const { c, lines } = makeWorld({ cfg: GATED, exposure })
  try {
    const state = await c.exposure.ready
    const mounts = mountsAt(await allPorts(c))
    assert.deepEqual(exposure.calls, [['ensure', mounts, true], ['check', mounts]])
    assert.equal(state.ok, true)
    assert.deepEqual(exposureLines(lines), [...mounts.map(m => mountedLine('mounted', m)), '[qa] exposure ok'])
  } finally { c.stop() }
})

test('GET /api/exposure reports mode, managed, ok, checkedAt, drift, added and error', async () => {
  // a pass that writes the harness mount, then finds the PR pane's handler
  // pointing elsewhere
  const exposure = fakeExposure({
    ensure: mounts => ({ added: [mounts[0]], ok: mounts.slice(1) }),
    check: mounts => ({ ok: false, drift: [{ mount: mounts[2], actual: 'http://127.0.0.1:9' }] }),
  })
  const before = Date.now()
  const { c } = makeWorld({ cfg: GATED, exposure })
  try {
    await c.exposure.ready
    const ports = await allPorts(c)
    const mounts = mountsAt(ports)
    const calls = exposure.calls.length
    const res = await raw(ports.harness, { path: '/qa/api/exposure', headers: ALLOWED })
    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'], /^application\/json/)
    const body = JSON.parse(res.body)
    assert.ok(body.checkedAt >= before && body.checkedAt <= Date.now(), String(body.checkedAt))
    assert.deepEqual({ ...body, checkedAt: 0 }, {
      mode: 'tailscale', managed: true, ok: false, checkedAt: 0,
      drift: [{ mount: mounts[2], actual: 'http://127.0.0.1:9' }], added: [mounts[0]], error: null,
    })
    assert.deepEqual(c.exposure.state(), body, 'state() is the same report')
    assert.deepEqual(JSON.parse((await raw(ports.harness, { path: '/api/exposure', headers: ALLOWED })).body), body)
    assert.equal(exposure.calls.length, calls, 'read-only: it never calls the adapter')
    // state() is a copy
    c.exposure.state().drift.length = 0
    assert.equal(c.exposure.state().drift.length, 1)

    // behind the identity gate, the Host check and the API guard
    assert.equal((await raw(ports.harness, { path: '/qa/api/exposure' })).status, 403)
    assert.equal((await raw(ports.harness, { path: '/qa/api/exposure', headers: { ...ALLOWED, host: 'attacker.example' } })).status, 421)
    const crossSite = await raw(ports.harness, { path: '/qa/api/exposure', headers: { ...ALLOWED, 'sec-fetch-site': 'same-site', origin: 'https://h:10000' } })
    assert.deepEqual([crossSite.status, JSON.parse(crossSite.body).error], [403, 'cross-site request refused'])
    const elsewhere = await raw(ports.harness, { path: '/qa/api/exposure', headers: { ...ALLOWED, host: 'h.ts.net:9999', 'sec-fetch-site': 'same-origin' } })
    assert.deepEqual([elsewhere.status, JSON.parse(elsewhere.body).error], [403, 'not the harness origin'])
  } finally { c.stop() }

  // with no adapter: unmanaged, never checked
  for (const [cfg, mode] of [[{}, 'none'], [GATED, 'tailscale']]) {
    const { c: w } = makeWorld({ cfg })
    try {
      const { harness } = await allPorts(w)
      assert.deepEqual(JSON.parse((await raw(harness, { path: '/qa/api/exposure', headers: ALLOWED })).body), { mode, ...UNMANAGED })
    } finally { w.stop() }
  }
})

test('an exposure failure is recorded and logged once, and a session still boots to ready', async () => {
  let failure = 'tailscale: connection refused'
  const exposure = fakeExposure({ ensure: () => { throw new Error(failure) } })
  const { c, lines } = makeWorld({ cfg: GATED, exposure })
  try {
    const state = await c.exposure.ready
    assert.deepEqual([state.ok, state.error, state.drift, state.added], [false, failure, [], []])
    assert.equal(typeof state.checkedAt, 'number')
    await c.exposure.reconcile()
    await c.exposure.reconcile()
    assert.equal(exposure.ensures(), 3)
    assert.deepEqual(exposureLines(lines), ['[qa] exposure failed: tailscale: connection refused'])

    // the conductor is unaffected
    const { harness } = await allPorts(c)
    assert.equal((await api(harness, 'POST', '/api/session', { pr: 7 }, ALLOWED)).ok, true)
    await waitFor(async () => (await api(harness, 'GET', '/api/state', undefined, ALLOWED)).status === 'ready')

    // another failure is news
    failure = 'tailscale: timed out'
    await c.exposure.reconcile()
    assert.deepEqual(exposureLines(lines).slice(1), ['[qa] exposure failed: tailscale: timed out'])
  } finally { c.stop() }

  // a layout no front door can publish is recorded the same way, and no
  // adapter call is made
  const unused = fakeExposure()
  const { c: w, errorLines } = makeWorld({ cfg: { ...GATED, paneOrigins: LOOPBACK_PANES }, exposure: unused })
  try {
    const state = await w.exposure.ready
    assert.equal(state.ok, false)
    assert.match(state.error, /^the base pane origin \(QA_BASE_ORIGIN\) http:\/\/127\.0\.0\.1:3101 is not https/)
    assert.deepEqual(unused.calls, [])
    assert.deepEqual(exposureLines(errorLines), [`[qa] exposure failed: ${state.error}`])
  } finally { w.stop() }

  // a check that says not ok, naming no drift, is never logged as ok
  const vague = fakeExposure({ check: () => ({ ok: false, drift: [] }) })
  const v = makeWorld({ cfg: GATED, exposure: vague })
  try {
    assert.equal((await v.c.exposure.ready).ok, false)
    assert.deepEqual(exposureLines(v.lines).slice(-1), ['[qa] exposure drift remains: (the adapter named no mount)'])
  } finally { v.c.stop() }
})

// The adapter is platform code. A value no Mount holds (a URL object as the
// target, a function, a Symbol) once made structuredClone throw inside the
// loop, and the unhandled rejection took the whole process down.
test('an adapter that reports values no Mount holds can\'t take the conductor down', async () => {
  const exposure = fakeExposure({
    ensure: mounts => ({ added: mounts.map(m => ({ ...m, target: new URL(m.target), extra: () => {} })), ok: [] }),
    check: mounts => ({
      ok: false,
      drift: [{ mount: { ...mounts[0], name: Symbol('harness'), port: 8444n, path: () => '/qa' }, actual: new URL('http://127.0.0.1:9') }],
    }),
  })
  const { c } = makeWorld({ cfg: GATED, exposure })
  try {
    const state = await c.exposure.ready
    const ports = await allPorts(c)
    const mounts = mountsAt(ports)
    // only the Mount type's own values survive: a string, or an integer port
    assert.deepEqual(state.added, mounts.map(m => ({ ...m, target: null })))
    assert.deepEqual(state.drift, [{ mount: { ...mounts[0], name: null, port: null, path: null }, actual: null }])
    const res = await raw(ports.harness, { path: '/qa/api/exposure', headers: ALLOWED })
    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body), state)
    assert.deepEqual(c.exposure.state(), state)
    await c.exposure.reconcile()
    assert.equal(exposure.ensures(), 2, 'the loop runs on')
  } finally { c.stop() }

  // a logger that throws can't either: the pass is still recorded, and the
  // next one runs
  const loud = fakeExposure()
  const w = makeWorld({ cfg: GATED, exposure: loud, logThrowsOn: /^\[qa\] exposure/ })
  try {
    assert.equal((await w.c.exposure.ready).ok, true)
    assert.equal((await w.c.exposure.reconcile()).ok, true)
    assert.equal(loud.ensures(), 2)
    const { harness } = await allPorts(w.c)
    assert.equal((await raw(harness, { path: '/qa/api/exposure', headers: ALLOWED })).status, 200)
  } finally { w.c.stop() }
})

test('every exposureIntervalMinutes another pass runs (default 5; an override is honoured)', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  for (const [cfg, ms] of [[GATED, 5 * 60_000], [{ ...GATED, exposureIntervalMinutes: 0.5 }, 30_000], [{ ...GATED, exposureIntervalMinutes: 90 }, 90 * 60_000]]) {
    const exposure = fakeExposure()
    const { c } = makeWorld({ cfg, exposure })
    try {
      await c.exposure.ready
      assert.equal(exposure.ensures(), 1)
      t.mock.timers.tick(ms - 1)
      assert.equal(exposure.ensures(), 1, `nothing before ${ms} ms`)
      t.mock.timers.tick(1)
      assert.equal(exposure.ensures(), 2, `a pass at ${ms} ms`)
      await c.exposure.reconcile() // joins the pass the tick started
      t.mock.timers.tick(ms)
      assert.equal(exposure.ensures(), 3)
      await c.exposure.reconcile()
      assert.equal(exposure.ensures(), 3)
    } finally { c.stop() }
  }
})

test('a tick while a pass hangs starts no second one', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const release = deferred()
  const exposure = fakeExposure({
    ensure: async (mounts, pass) => {
      if (pass === 1) await release.promise
      return { added: [], ok: mounts }
    },
  })
  const { c } = makeWorld({ cfg: GATED, exposure })
  try {
    await waitFor(() => exposure.ensures() === 1)
    const inFlight = c.exposure.reconcile()
    assert.equal(c.exposure.reconcile(), inFlight, 'reconcile() joins the pass in flight')
    for (let i = 0; i < 3; i++) t.mock.timers.tick(5 * 60_000)
    assert.equal(exposure.ensures(), 1, 'no second pass while the first hangs')
    assert.equal(c.exposure.state().checkedAt, null)

    release.resolve()
    assert.equal((await inFlight).ok, true)
    assert.equal((await c.exposure.ready).ok, true)
    t.mock.timers.tick(5 * 60_000)
    assert.equal(exposure.ensures(), 2, 'the next tick runs a pass')
  } finally { c.stop() }
})

test('after stop() or shutdown() a tick runs nothing', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const setIntervalSpy = t.mock.method(globalThis, 'setInterval')
  const clearIntervalSpy = t.mock.method(globalThis, 'clearInterval')
  for (const end of ['stop', 'shutdown']) {
    const exposure = fakeExposure()
    const { c, conductor } = makeWorld({ cfg: GATED, exposure })
    try {
      await c.exposure.ready
      const loop = setIntervalSpy.mock.calls.findLast(call => call.arguments[1] === 5 * 60_000).result
      if (end === 'stop') conductor.stop()
      else await conductor.shutdown()
      assert.ok(clearIntervalSpy.mock.calls.some(call => call.arguments[0] === loop), `${end} clears the loop's timer`)
      t.mock.timers.tick(3 * 5 * 60_000)
      const state = await c.exposure.reconcile()
      assert.equal(exposure.ensures(), 1, `${end}: no pass after it, from a tick or reconcile()`)
      assert.equal(state.ok, true, `${end}: the last report stands`)
    } finally { c.stop() }
  }

  // shutdown() doesn't wait for a pass in flight, and ready settles
  const release = deferred()
  const hung = fakeExposure({ ensure: async mounts => { await release.promise; return { added: [], ok: mounts } } })
  const w = makeWorld({ cfg: GATED, exposure: hung })
  try {
    await waitFor(() => hung.ensures() === 1)
    await w.conductor.shutdown()
    assert.equal((await w.c.exposure.ready).checkedAt, null)
    t.mock.timers.tick(3 * 5 * 60_000)
    assert.equal(hung.ensures(), 1)
  } finally { release.resolve(); w.closeApps() }

  // ready settles even when shutdown() runs before the servers listen
  const early = fakeExposure()
  const e = makeWorld({ cfg: GATED, exposure: early })
  try {
    await e.conductor.shutdown()
    assert.deepEqual(await e.c.exposure.ready, { mode: 'tailscale', ...UNMANAGED, managed: true })
    await new Promise(r => setTimeout(r, 20))
    assert.deepEqual(early.calls, [])
  } finally { e.closeApps() }
})

test('a mount that drifts back is logged as restored', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  // pass 1 writes all three; pass 2 rewrites the PR pane's handler, which
  // had gone; passes 3 and 4 find a handler that shadows the harness, which
  // ensure leaves alone; pass 5 finds everything in place
  const shadowed = [3, 4]
  const exposure = fakeExposure({
    ensure: (mounts, pass) => ({ added: pass === 1 ? mounts : pass === 2 ? [mounts[2]] : [], ok: [] }),
    check: (mounts, pass) => (shadowed.includes(pass)
      ? { ok: false, drift: [{ mount: mounts[0], actual: '/qa/ -> http://127.0.0.1:9' }, { mount: mounts[0], actual: '/qa/api (not a proxy)' }] }
      : { ok: true, drift: [] }),
  })
  const { c, lines, errorLines } = makeWorld({ cfg: GATED, exposure })
  const tick = async () => {
    t.mock.timers.tick(5 * 60_000)
    await c.exposure.reconcile()
  }
  try {
    await c.exposure.ready
    const mounts = mountsAt(await allPorts(c))
    assert.deepEqual(exposureLines(lines), [...mounts.map(m => mountedLine('mounted', m)), '[qa] exposure ok'])
    await tick()
    assert.deepEqual(exposureLines(lines).slice(4), [mountedLine('restored', mounts[2])], 'still ok: no second ok line')
    await tick()
    await tick()
    assert.deepEqual(exposureLines(lines).slice(5), ['[qa] exposure drift remains: 8444/qa'], 'once, and once per mount')
    assert.ok(errorLines.includes('[qa] exposure drift remains: 8444/qa'))
    await tick()
    await tick()
    assert.deepEqual(exposureLines(lines).slice(6), ['[qa] exposure ok'])
  } finally { c.stop() }

  // a mount first written on a later pass is mounted, not restored
  const partial = fakeExposure({
    ensure: (mounts, pass) => {
      if (pass === 1) throw Object.assign(new Error('could not mount 10000/'), { added: mounts.slice(0, 2) })
      return { added: [mounts[2]], ok: mounts.slice(0, 2) }
    },
  })
  const w = makeWorld({ cfg: GATED, exposure: partial })
  try {
    await w.c.exposure.ready
    const mounts = mountsAt(await allPorts(w.c))
    await w.c.exposure.reconcile()
    await w.c.exposure.reconcile()
    assert.deepEqual(exposureLines(w.lines), [
      mountedLine('mounted', mounts[0]), mountedLine('mounted', mounts[1]), '[qa] exposure failed: could not mount 10000/',
      mountedLine('mounted', mounts[2]), '[qa] exposure ok',
      mountedLine('restored', mounts[2]),
    ])
  } finally { w.c.stop() }

  // a restart onto mounts already in place (a fixed-port deploy): pass 1
  // writes nothing, so a mount that goes later and comes back is restored
  const deployed = fakeExposure({ ensure: (mounts, pass) => ({ added: pass === 2 ? [mounts[1]] : [], ok: [] }) })
  const d = makeWorld({ cfg: GATED, exposure: deployed })
  try {
    await d.c.exposure.ready
    const mounts = mountsAt(await allPorts(d.c))
    await d.c.exposure.reconcile()
    assert.deepEqual(exposureLines(d.lines), ['[qa] exposure ok', mountedLine('restored', mounts[1])])
  } finally { d.c.stop() }
})

// A platform may assign cfg.paneOrigins after start, so no pass reuses the
// mounts an earlier one derived.
test('every pass derives the mounts afresh from cfg', async () => {
  const exposure = fakeExposure()
  const { c, cfg } = makeWorld({ cfg: GATED, exposure })
  try {
    await c.exposure.ready
    const ports = await allPorts(c)
    cfg.paneOrigins = { ...cfg.paneOrigins, pr: 'https://h:10001' }
    await c.exposure.reconcile()
    const ensures = exposure.calls.filter(([fn]) => fn === 'ensure')
    assert.equal(ensures.length, 2)
    assert.deepEqual(ensures[1][1][2], { name: 'pr', host: 'h', port: 10001, path: '/', target: `http://127.0.0.1:${ports.pr}` })
  } finally { c.stop() }
})

test('an adapter with QA_EXPOSURE=none refuses to start', () => {
  const message = 'adapters.exposure needs QA_EXPOSURE=tailscale: an ungated conductor must not publish itself'
  // set, or defaulted from a loopback layout
  for (const cfg of [{ exposure: 'none' }, { exposure: undefined, publicHost: null, paneOrigins: LOOPBACK_PANES }]) {
    const exposure = fakeExposure()
    assert.throws(() => startOnly(cfg, { exposure }), { message }, JSON.stringify(cfg))
    assert.deepEqual(exposure.calls, [])
  }
  // none mode without one, and tailscale mode with one, start
  startOnly({ exposure: 'none' }, { exposure: null })
  startOnly(GATED, { exposure: fakeExposure() })
})

test('tailscale mode without an adapter: managed false, the managed-outside line, no timer', async t => {
  const setIntervalSpy = t.mock.method(globalThis, 'setInterval')
  const delays = () => setIntervalSpy.mock.calls.map(call => call.arguments[1])
  for (const [cfg, mode, outside] of [[GATED, 'tailscale', true], [{}, 'none', false]]) {
    setIntervalSpy.mock.resetCalls()
    const { c, logLines } = makeWorld({ cfg })
    try {
      await allPorts(c)
      const state = await c.exposure.ready
      assert.deepEqual(state, { mode, ...UNMANAGED })
      assert.deepEqual(await c.exposure.reconcile(), state, 'reconcile() runs nothing')
      assert.equal(logLines.includes(MANAGED_OUTSIDE), outside, mode)
      assert.deepEqual(delays(), [60_000], `${mode}: only the idle reaper`)
    } finally { c.stop() }
  }
  // with an adapter, the loop's timer is the only other one
  setIntervalSpy.mock.resetCalls()
  const { c, logLines } = makeWorld({ cfg: GATED, exposure: fakeExposure() })
  try {
    await c.exposure.ready
    assert.deepEqual(delays(), [60_000, 5 * 60_000])
    assert.equal(logLines.includes(MANAGED_OUTSIDE), false)
  } finally { c.stop() }
})

test('startConductor refuses exposureIntervalMinutes 0, -1, NaN and 35792', async () => {
  for (const bad of [0, -1, NaN, 35792, Infinity, '5', true]) {
    assert.throws(() => startOnly({ exposureIntervalMinutes: bad }), err => {
      assert.match(err.message, /^startConductor: cfg\.exposureIntervalMinutes must be a number of minutes above 0 and at most 35791 \(the longest a timer can wait\), got /)
      return true
    }, String(bad))
  }
  // in any mode, with an adapter or without
  assert.throws(() => startOnly({ ...GATED, exposureIntervalMinutes: -1 }, { exposure: fakeExposure() }), /cfg\.exposureIntervalMinutes/)
  for (const minutes of [35791, 0.5, undefined, null]) {
    const { c } = makeWorld({ cfg: { ...GATED, exposureIntervalMinutes: minutes }, exposure: fakeExposure() })
    try {
      assert.equal((await c.exposure.ready).ok, true, String(minutes))
    } finally { c.stop() }
  }
})
