// Integration tests for startConductor over real HTTP (ephemeral ports) with
// fake adapters — no docker, no network beyond loopback.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

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
// Each pane "app" is a real loopback server, so the pane proxies can be
// exercised.
function makeWorld({
  hang = {}, failAt = null, sweepGate = null, sweepFails = false, provisioner: provisionerOverrides = {},
  cfg: cfgOverrides = {}, readBaseEnv: readBaseEnvOverride = null,
} = {}) {
  const calls = []
  const apps = {
    base: http.createServer((req, res) => res.end('pane-base')),
    pr: http.createServer((req, res) => res.end('pane-pr')),
  }
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
  }
  const cfg = {
    publicHost: 'h.ts.net', operatorEmail: 'op@homefree.local', idleMinutes: 30,
    ports: { harness: 0, base: 0, pr: 0 },
    paneOrigins: { base: 'https://h:8443', pr: 'https://h:10000' },
    verdictLabels: { accept: 'ok', reject: 'nope' },
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
  const quiet = { log: (...a) => logLines.push(a.join(' ')), error: (...a) => errorLines.push(a.join(' ')) }
  const conductor = startConductor({ cfg, github, fsx, adapters, readBaseEnv, log: quiet })
  const closeApps = () => { for (const s of Object.values(apps)) s.close() }
  const c = { ...conductor, stop() { conductor.stop(); closeApps() } }
  return { c, conductor, closeApps, calls, adapters, github, cfg, logLines, errorLines }
}

async function proxyPort(server) {
  if (!server.listening) await new Promise(r => server.once('listening', r))
  return server.address().port
}

async function harnessPort(c) {
  return proxyPort(c.servers.harness)
}

// POSTs always carry a JSON content type (the harness requires it).
async function api(port, method, path, body) {
  const post = method === 'POST'
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: post ? { 'content-type': 'application/json' } : {}, body: post ? JSON.stringify(body ?? {}) : undefined,
  })
  return res.json()
}

// A request with full control over the headers (fetch cannot set Host).
function raw(port, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
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

test('allowed Hosts: loopback, the public host, the pane origin hosts, QA_ALLOWED_HOSTS', async () => {
  const { c, cfg } = makeWorld({ cfg: { allowedHosts: ['qa.corp.example'] } })
  try {
    const port = await harnessPort(c)
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, 'h.ts.net', 'H.TS.NET:443', 'h:8443', 'qa.corp.example']) {
      assert.equal((await raw(port, { path: '/api/state', headers: { host } })).status, 200, host)
    }
    // pane origins are read per request (a platform may assign them after start)
    assert.equal((await raw(port, { path: '/api/state', headers: { host: 'late.example' } })).status, 421)
    cfg.paneOrigins = { base: 'http://late.example:4101', pr: 'http://127.0.0.1:4102' }
    assert.equal((await raw(port, { path: '/api/state', headers: { host: 'late.example' } })).status, 200)
    const base = await proxyPort(c.servers.baseProxy)
    assert.equal((await raw(base, { path: '/', headers: { host: 'late.example:4101' } })).status, 503, 'proxies share the allowlist')
  } finally { c.stop() }
})

test('a cross-site POST to the API gets 403; same-origin and non-browser POSTs pass', async () => {
  const { c, calls } = makeWorld()
  try {
    const port = await harnessPort(c)
    const host = `127.0.0.1:${port}`
    const json = { 'content-type': 'application/json' }
    const post = (path, headers) => raw(port, { method: 'POST', path, headers: { host, ...json, ...headers }, body: '{}' })
    for (const headers of [
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      // sec-fetch-site wins over a matching origin
      { 'sec-fetch-site': 'cross-site', origin: `http://${host}` },
      { origin: 'http://attacker.example' },
      { origin: `http://127.0.0.1:${port + 1}` },
      { origin: 'null' },
    ]) {
      assert.equal((await post('/api/teardown', headers)).status, 403, JSON.stringify(headers))
      assert.equal((await post('/qa/api/teardown', headers)).status, 403, `/qa prefix: ${JSON.stringify(headers)}`)
    }
    assert.equal(calls.some(x => x[0] === 'teardown'), false, 'a refused request does nothing')
    // the check covers every non-GET/HEAD /api/* request, routed or not
    assert.equal((await post('/api/nope', { origin: 'http://attacker.example' })).status, 403)

    assert.equal((await post('/api/teardown', { 'sec-fetch-site': 'same-origin' })).status, 200)
    assert.equal((await post('/api/teardown', { 'sec-fetch-site': 'none' })).status, 200)
    assert.equal((await post('/api/teardown', { origin: `http://${host}` })).status, 200)
    assert.equal((await post('/api/teardown', {})).status, 200, 'no browser headers: a non-browser client')
    // reads are not checked
    assert.equal((await raw(port, { path: '/api/state', headers: { host, 'sec-fetch-site': 'cross-site' } })).status, 200)
  } finally { c.stop() }
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

    // the sweep has settled: a later boot shows no cleanup message at all
    await api(port, 'POST', '/api/teardown')
    await api(port, 'POST', '/api/session', { pr: 7 })
    const second = await sseEvents(port, evs => evs.some(e => e.kind === 'ready'))
    assert.deepEqual(buildMessages(second), [])
    assert.equal((await api(port, 'GET', '/api/state')).buildRun, null)
  } finally { c.stop() }
})
