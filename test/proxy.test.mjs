import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPaneProxy, parseSetCookie, requestHostname, isAllowedHost, panePolicy,
} from '../lib/proxy.mjs'

const BRIDGE_TAG = '<script src="/__qa/bridge.js"></script>'
const HARNESS = 'https://h.ts.net:8444'
// The tag the proxy injects: plain without a harness origin, else carrying it.
const tagFor = harnessOrigin => (harnessOrigin ? `<script src="/__qa/bridge.js" data-harness="${harnessOrigin}"></script>` : BRIDGE_TAG)

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function request(port, path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks) }),
      )
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function setup(t, upstreamHandler, { allowedHosts = [], harnessOrigin, frameAncestors, forwardClientCookies } = {}) {
  const upstream = http.createServer(upstreamHandler)
  const upstreamPort = await listen(upstream)
  const dir = await mkdtemp(join(tmpdir(), 'qa-proxy-'))
  const bridgePath = join(dir, 'bridge.js')
  await writeFile(bridgePath, 'window.__qaBridge = 1\n')
  const activity = { count: 0 }
  const handler = createPaneProxy({
    upstreamPort,
    bridgePath,
    onActivity: () => {
      activity.count += 1
    },
    httpMod: http,
    allowedHosts,
    harnessOrigin,
    frameAncestors,
    forwardClientCookies,
  })
  const proxy = http.createServer(handler)
  const proxyPort = await listen(proxy)
  t.after(async () => {
    await new Promise((r) => upstream.close(r))
    await new Promise((r) => proxy.close(r))
    await rm(dir, { recursive: true, force: true })
  })
  return { upstreamPort, proxyPort, activity, bridgePath, handler }
}

// --- parseSetCookie -------------------------------------------------------

test('parseSetCookie: plain name=value', () => {
  assert.deepEqual(parseSetCookie('sid=abc123'), { name: 'sid', value: 'abc123', remove: false })
})

test('parseSetCookie: ignores attributes, keeps value with embedded =', () => {
  const parsed = parseSetCookie('sid=a=b=c; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600')
  assert.deepEqual(parsed, { name: 'sid', value: 'a=b=c', remove: false })
})

test('parseSetCookie: Max-Age=0 removes', () => {
  assert.equal(parseSetCookie('sid=whatever; Path=/; Max-Age=0').remove, true)
})

test('parseSetCookie: Expires in the past removes', () => {
  assert.equal(parseSetCookie('sid=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT').remove, true)
})

test('parseSetCookie: Expires in the future does not remove', () => {
  assert.equal(parseSetCookie('sid=x; Expires=Fri, 01 Jan 2100 00:00:00 GMT').remove, false)
})

test('parseSetCookie: value "deleted" removes', () => {
  assert.equal(parseSetCookie('sid=deleted').remove, true)
})

test('parseSetCookie: positive Max-Age wins over past Expires', () => {
  const parsed = parseSetCookie('sid=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=3600')
  assert.equal(parsed.remove, false)
})

// --- proxying basics ------------------------------------------------------

test('proxies method, path, body and headers; host stripped; accept-encoding forced to identity', async (t) => {
  let seen
  const { upstreamPort, proxyPort } = await setup(t, (req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }
      res.end('ok')
    })
  })
  const res = await request(proxyPort, '/submit?q=1', {
    method: 'POST',
    headers: { 'x-test': 'forwarded', 'content-type': 'text/plain', 'accept-encoding': 'gzip, br' },
    body: 'hello=world',
  })
  assert.equal(res.status, 200)
  assert.equal(seen.method, 'POST')
  assert.equal(seen.url, '/submit?q=1')
  assert.equal(seen.body, 'hello=world')
  assert.equal(seen.headers['x-test'], 'forwarded')
  assert.equal(seen.headers['accept-encoding'], 'identity')
  assert.equal(seen.headers.host, `127.0.0.1:${upstreamPort}`)
})

// tailscale serve adds the reviewer's login, name and picture to every
// request it proxies. The gate has read them; PR code must not.
test('Tailscale identity headers never reach the pane app', async (t) => {
  const seen = []
  const { proxyPort } = await setup(t, (req, res) => {
    seen.push(req.headers)
    res.end('ok')
  })
  const identity = {
    'Tailscale-User-Login': 'alice@github',
    'Tailscale-User-Name': 'Alice Example',
    'Tailscale-User-Profile-Pic': 'https://example.com/a.png',
    'Tailscale-Headers-Info': 'https://tailscale.com/s/serve-headers',
    'tailscale-app-capabilities': '{}',
  }
  for (const method of ['GET', 'POST']) {
    const res = await request(proxyPort, '/x', { method, headers: { ...identity, 'x-kept': '1', 'x-tailscale-user-login': 'kept too' }, body: method === 'POST' ? 'b' : null })
    assert.equal(res.status, 200)
  }
  assert.equal(seen.length, 2)
  for (const headers of seen) {
    assert.deepEqual(Object.keys(headers).filter(k => k.startsWith('tailscale-')), [])
    assert.equal(headers['x-kept'], '1')
    assert.equal(headers['x-tailscale-user-login'], 'kept too')
  }
})

// The identity gate's marker is the conductor's to send. A pane app (PR code)
// that sets it must not make an ungated pane look gated to the expose CLI.
test('a pane app\'s X-QA-Refusal never reaches the client', async (t) => {
  const { proxyPort } = await setup(t, (req, res) => {
    res.statusCode = 403
    res.setHeader('x-qa-refusal', 'identity')
    res.setHeader('x-other', 'kept')
    res.end('nope')
  })
  const res = await request(proxyPort, '/')
  assert.equal(res.status, 403)
  assert.equal(res.headers['x-qa-refusal'], undefined)
  assert.equal(res.headers['x-other'], 'kept')
})

// --- cookie jar -----------------------------------------------------------

test('absorbs Set-Cookie into the jar, replays it upstream, honors deletions', async (t) => {
  let n = 0
  const { proxyPort } = await setup(t, (req, res) => {
    n += 1
    res.setHeader('x-seen-cookie', req.headers.cookie ?? '')
    if (n === 1) {
      res.setHeader('set-cookie', ['sid=abc; Path=/; HttpOnly', 'theme=dark'])
    } else if (n === 2) {
      res.setHeader('set-cookie', 'sid=deleted; Max-Age=0')
    }
    res.end(String(n))
  })

  const first = await request(proxyPort, '/')
  assert.equal(first.headers['set-cookie'], undefined, 'Set-Cookie must never reach the client')

  const second = await request(proxyPort, '/')
  assert.equal(second.headers['x-seen-cookie'], 'sid=abc; theme=dark')
  assert.equal(second.headers['set-cookie'], undefined)

  const third = await request(proxyPort, '/')
  assert.equal(third.headers['x-seen-cookie'], 'theme=dark', 'deleted cookie must leave the jar')
})

// --- the browser's own cookies --------------------------------------------
// Cookies ignore ports, so the Cookie header a browser sends a pane carries
// every cookie for the pane's hostname: another app's on another port (an RC
// app's session, say), and any the other pane's scripts set. The pane app
// runs PR code, so by default it gets the jar's cookies and nothing else.

// An upstream that answers with the Cookie header it got, or '(none)'. Its
// /login fills the jar.
const echoCookie = (req, res) => {
  if (req.url === '/login') res.setHeader('set-cookie', ['sid=abc; Path=/; HttpOnly', 'theme=dark'])
  res.end(req.headers.cookie ?? '(none)')
}
const BROWSER_COOKIES = { cookie: 'rc_session=secret; theme=light; csrftoken=c1; locale=fr' }

test('the browser\'s own cookies never reach the pane app by default; with an empty jar it gets no Cookie header at all', async (t) => {
  for (const forwardClientCookies of [undefined, null, false, []]) {
    const { proxyPort } = await setup(t, echoCookie, { forwardClientCookies })
    for (const method of ['GET', 'POST']) {
      const res = await request(proxyPort, '/echo', { method, headers: BROWSER_COOKIES, body: method === 'POST' ? 'x' : null })
      assert.deepEqual([res.status, res.body.toString()], [200, '(none)'], `${method} ${JSON.stringify(forwardClientCookies)}`)
    }
  }
})

test('the jar\'s cookies still reach the pane app, and only they', async (t) => {
  const { proxyPort } = await setup(t, echoCookie)
  await request(proxyPort, '/login', { headers: BROWSER_COOKIES })
  assert.equal((await request(proxyPort, '/echo', { headers: BROWSER_COOKIES })).body.toString(), 'sid=abc; theme=dark', 'the jar\'s theme, not the browser\'s')
  assert.equal((await request(proxyPort, '/echo')).body.toString(), 'sid=abc; theme=dark')
})

// The jar lasts as long as the proxy; the conductor empties it between
// sessions (test/server.test.mjs).
test('clearJar empties the jar, which then fills again from the app\'s Set-Cookie', async (t) => {
  const { proxyPort, handler } = await setup(t, echoCookie, { forwardClientCookies: ['locale'] })
  const echo = async () => (await request(proxyPort, '/echo', { headers: BROWSER_COOKIES })).body.toString()
  await request(proxyPort, '/login')
  assert.equal(await echo(), 'sid=abc; theme=dark; locale=fr')
  handler.clearJar()
  assert.equal(await echo(), 'locale=fr', 'the named browser cookie still passes')
  await request(proxyPort, '/login')
  assert.equal(await echo(), 'sid=abc; theme=dark; locale=fr')
})

// A response the old app sends after the jar is cleared belongs to the old
// session: its Set-Cookie must fill the jar its request started with, never
// the fresh one the next session's app gets.
test('a response that lands after clearJar fills only the jar its request started with', async (t) => {
  let arrived
  const reached = new Promise(r => { arrived = r })
  let release
  const late = new Promise(r => { release = r })
  const { proxyPort, handler } = await setup(t, (req, res) => {
    if (req.url === '/slow-login') {
      arrived()
      late.then(() => { res.setHeader('set-cookie', 'sid=old-session'); res.end('ok') })
      return
    }
    res.end(req.headers.cookie ?? '(none)')
  })
  const pending = request(proxyPort, '/slow-login')
  await reached
  handler.clearJar()
  release()
  await pending
  assert.equal((await request(proxyPort, '/echo')).body.toString(), '(none)')
})

test('forwardClientCookies passes the browser cookies it names, and no others', async (t) => {
  const { proxyPort } = await setup(t, echoCookie, { forwardClientCookies: ['csrftoken', 'locale', 'absent'] })
  const res = await request(proxyPort, '/echo', { headers: { cookie: 'rc_session=secret; csrftoken=c1; Locale=x; locale=fr; csrftoken2=no; =nameless; bare' } })
  assert.equal(res.body.toString(), 'csrftoken=c1; locale=fr', 'names match exactly, case included')
  // a name sent twice (two paths) reaches the app as the browser sent it
  assert.equal((await request(proxyPort, '/echo', { headers: { cookie: 'locale=fr-CA; rc_session=secret; locale=fr' } })).body.toString(), 'locale=fr-CA; locale=fr')
  // none of the named ones sent, and an empty jar: no Cookie header
  assert.equal((await request(proxyPort, '/echo', { headers: { cookie: 'rc_session=secret' } })).body.toString(), '(none)')
})

test('the jar wins over a named browser cookie of the same name, and comes first', async (t) => {
  const { proxyPort } = await setup(t, echoCookie, { forwardClientCookies: ['sid', 'locale'] })
  await request(proxyPort, '/login')
  const res = await request(proxyPort, '/echo', { headers: { cookie: 'sid=forged; locale=fr; sid=forged2' } })
  assert.equal(res.body.toString(), 'sid=abc; theme=dark; locale=fr')
})

// A browser keeps whatever a page writes with document.cookie, commas and
// spaces included, and sends it back as is. So any page on the hostname, the
// PR pane's included, could hide a cookie that isn't named inside one that
// is, and a parser that splits on commas or spaces would read it.
test('a named browser cookie whose value is not an RFC 6265 cookie-value is dropped, so no other cookie hides in it', async (t) => {
  const { proxyPort } = await setup(t, echoCookie, { forwardClientCookies: ['locale'] })
  const echo = async cookie => (await request(proxyPort, '/echo', { headers: { cookie } })).body.toString()
  const SMUGGLED = [
    'locale=fr, sid=evil', 'locale=fr,sid=evil', 'locale=fr sid=evil', 'locale=fr\tsid=evil',
    'locale="fr, sid=evil"', 'locale="fr sid=evil"', 'locale=fr\\', 'locale="fr', 'locale=fr"', 'locale=a"b', 'locale=""fr""',
  ]
  for (const cookie of SMUGGLED) assert.equal(await echo(cookie), '(none)', cookie)
  for (const value of ['fr', '"fr-CA"', '', '""', 'a=b', "!#$%&'()*+-./:<=>?@[]^_`{|}~09AZaz"]) {
    assert.equal(await echo(`rc_session=secret; locale=${value}`), `locale=${value}`, value)
  }
  // with a session in the jar: the jar's sid, and a clean locale beside a dropped one
  await request(proxyPort, '/login')
  for (const cookie of SMUGGLED) assert.equal(await echo(cookie), 'sid=abc; theme=dark', cookie)
  assert.equal(await echo('locale=fr, sid=evil; locale=de; locale=fr sid=evil'), 'sid=abc; theme=dark; locale=de')
})

// Both panes are on one hostname, so a cookie the PR pane's scripts set
// (document.cookie) comes back on the browser's requests to the base pane,
// and to every other port of that host.
test('a cookie one pane\'s scripts set never reaches the other pane\'s app', async (t) => {
  const seen = []
  const base = await setup(t, (req, res) => { seen.push(req.headers.cookie ?? '(none)'); res.end('base') }, { ...GUARDED, forwardClientCookies: ['locale'] })
  const pr = await setup(t, (req, res) => {
    res.setHeader('content-type', 'text/html')
    res.setHeader('set-cookie', 'pr_sid=1')
    res.end('<html><head></head><body><script>document.cookie = "planted=1; path=/"</script></body></html>')
  }, GUARDED)
  const page = await request(pr.proxyPort, '/', { headers: { ...PANE_HOST, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' } })
  assert.deepEqual([page.status, page.headers['set-cookie']], [200, undefined], 'the PR app\'s own cookie stays in its jar')
  // the PR page's script has run: the browser now sends planted=1 to the base pane too
  const BASE_HOST = { host: 'h.ts.net:8443' }
  for (const headers of [
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' },
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
    {},
  ]) {
    const res = await request(base.proxyPort, '/api/me', { headers: { ...BASE_HOST, cookie: 'planted=1; locale=fr', ...headers } })
    assert.equal(res.status, 200, JSON.stringify(headers))
  }
  assert.deepEqual(seen, ['locale=fr', 'locale=fr', 'locale=fr'])
})

test('forwardClientCookies takes false or an array of cookie names; true, a string, a wildcard or a name that is not an RFC 6265 token throws', () => {
  const make = forwardClientCookies => createPaneProxy({ upstreamPort: () => null, bridgePath: '/nonexistent', httpMod: http, forwardClientCookies })
  for (const ok of [undefined, null, false, [], ['sid'], ['__Host-sid', 'csrftoken', 'sid'], ["a!#$%&'+-.^_`|~9Z"]]) {
    assert.equal(typeof make(ok), 'function', JSON.stringify(ok))
  }
  for (const bad of [true, 1, '*', 'sid', 'sid,locale', {}, ['*'], ['sid', '*'], ['sess*'], ['a b'], [' sid'], ['a=b'], ['a;b'], ['a,b'], ['"sid"'], ['a\tb'], ['séance'], [''], [42], [null], [['sid']]]) {
    assert.throws(() => make(bad), /^Error: forwardClientCookies must be false or an array of cookie names \(RFC 6265 tokens; no wildcards: list each name\), got /, JSON.stringify(bad))
  }
})

// --- HTML injection -------------------------------------------------------

// Each runs without a harness origin (the plain tag) and with one (the tag
// carries it as data-harness).
test('injects the bridge script before </head> (case-insensitive) and fixes Content-Length', async (t) => {
  const page = '<html><HEAD><title>x</title></HEAD><body>hi</body></html>'
  for (const harnessOrigin of [undefined, HARNESS]) {
    const { proxyPort } = await setup(t, (req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(page)
    }, { harnessOrigin })
    const res = await request(proxyPort, '/')
    const html = res.body.toString()
    const tag = tagFor(harnessOrigin)
    assert.ok(html.includes(`${tag}</HEAD>`), `script goes immediately before </head>: ${html}`)
    assert.equal(html.split('/__qa/bridge.js').length - 1, 1, 'injected exactly once')
    assert.equal(Number(res.headers['content-length']), res.body.length)
  }
})

test('HTML without </head> gets the script prepended to the body start', async (t) => {
  for (const harnessOrigin of [undefined, HARNESS]) {
    const { proxyPort } = await setup(t, (req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<p>bare fragment</p>')
    }, { harnessOrigin })
    const res = await request(proxyPort, '/')
    const html = res.body.toString()
    assert.ok(html.startsWith(tagFor(harnessOrigin)), html)
    assert.ok(html.endsWith('<p>bare fragment</p>'))
    assert.equal(Number(res.headers['content-length']), res.body.length)
  }
})

test('injects into HTML responses of any status', async (t) => {
  for (const harnessOrigin of [undefined, HARNESS]) {
    const { proxyPort } = await setup(t, (req, res) => {
      res.statusCode = 404
      res.setHeader('content-type', 'text/html')
      res.end('<html><head></head><body>not found</body></html>')
    }, { harnessOrigin })
    const res = await request(proxyPort, '/missing')
    assert.equal(res.status, 404)
    assert.ok(res.body.toString().includes(`${tagFor(harnessOrigin)}</head>`))
  }
})

test('streams non-HTML responses untouched (binary-safe)', async (t) => {
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
  const { proxyPort } = await setup(t, (req, res) => {
    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('content-length', bytes.length)
    res.end(bytes)
  })
  const res = await request(proxyPort, '/blob')
  assert.deepEqual(res.body, bytes)
  assert.equal(Number(res.headers['content-length']), bytes.length)
  assert.ok(!res.body.toString('latin1').includes('__qa/bridge.js'))
})

// --- bridge serving -------------------------------------------------------

test('GET /__qa/bridge.js serves the bridge file, re-read per request', async (t) => {
  const { proxyPort, bridgePath } = await setup(t, (req, res) => res.end('ok'))
  const first = await request(proxyPort, '/__qa/bridge.js')
  assert.equal(first.status, 200)
  assert.match(first.headers['content-type'], /^text\/javascript/)
  assert.equal(first.body.toString(), 'window.__qaBridge = 1\n')

  await writeFile(bridgePath, 'window.__qaBridge = 2\n')
  const second = await request(proxyPort, '/__qa/bridge.js')
  assert.equal(second.body.toString(), 'window.__qaBridge = 2\n', 'no caching')
})

// --- activity -------------------------------------------------------------

test('calls onActivity once per proxied request', async (t) => {
  const { proxyPort, activity } = await setup(t, (req, res) => res.end('ok'))
  await request(proxyPort, '/a')
  await request(proxyPort, '/b')
  assert.equal(activity.count, 2)
})

// --- errors ---------------------------------------------------------------

test('upstream connection error yields a 502', async (t) => {
  const dead = http.createServer(() => {})
  const deadPort = await listen(dead)
  await new Promise((r) => dead.close(r))
  const dir = await mkdtemp(join(tmpdir(), 'qa-proxy-'))
  const bridgePath = join(dir, 'bridge.js')
  await writeFile(bridgePath, '')
  const proxy = http.createServer(
    createPaneProxy({ upstreamPort: deadPort, bridgePath, onActivity: () => {}, httpMod: http, harnessOrigin: HARNESS }),
  )
  const proxyPort = await listen(proxy)
  t.after(async () => {
    await new Promise((r) => proxy.close(r))
    await rm(dir, { recursive: true, force: true })
  })
  const res = await request(proxyPort, '/')
  assert.equal(res.status, 502)
  assert.ok(res.body.length > 0)
  // the proxy's own responses carry the pane frame policy without the
  // conductor's paneHeaders in front
  assert.equal(res.headers['content-security-policy'], `frame-ancestors 'self' ${HARNESS}`)
})

test('a missing bridge file yields a 404 that carries the pane frame policy', async (t) => {
  const proxy = http.createServer(createPaneProxy({ upstreamPort: () => null, bridgePath: '/nonexistent/bridge.js', httpMod: http, harnessOrigin: HARNESS }))
  const proxyPort = await listen(proxy)
  t.after(() => new Promise((r) => proxy.close(r)))
  const res = await request(proxyPort, '/__qa/bridge.js')
  assert.equal(res.status, 404)
  assert.equal(res.headers['content-security-policy'], `frame-ancestors 'self' ${HARNESS}`)
})

// --- redirects ------------------------------------------------------------

test('rewrites absolute upstream Locations to relative, passes others through', async (t) => {
  let upstreamPortRef
  const { upstreamPort, proxyPort } = await setup(t, (req, res) => {
    res.statusCode = 302
    if (req.url === '/absolute') {
      res.setHeader('location', `http://127.0.0.1:${upstreamPortRef}/next?a=1`)
    } else if (req.url === '/relative') {
      res.setHeader('location', '/plain')
    } else {
      res.setHeader('location', 'https://example.com/x')
    }
    res.end()
  })
  upstreamPortRef = upstreamPort

  const absolute = await request(proxyPort, '/absolute')
  assert.equal(absolute.status, 302)
  assert.equal(absolute.headers.location, '/next?a=1')

  const relative = await request(proxyPort, '/relative')
  assert.equal(relative.headers.location, '/plain')

  const foreign = await request(proxyPort, '/foreign')
  assert.equal(foreign.headers.location, 'https://example.com/x')
})

// --- upstream resolution ---------------------------------------------------

test('upstreamPort may be a function, resolved per request', async (t) => {
  const a = http.createServer((req, res) => res.end('A'))
  const b = http.createServer((req, res) => res.end('B'))
  const portA = await listen(a)
  const portB = await listen(b)
  let current = portA
  const proxy = http.createServer(createPaneProxy({ upstreamPort: () => current, bridgePath: '/nonexistent', httpMod: http }))
  const proxyPort = await listen(proxy)
  t.after(async () => { for (const s of [a, b, proxy]) await new Promise(r => s.close(r)) })
  assert.equal((await request(proxyPort, '/')).body.toString(), 'A')
  current = portB
  assert.equal((await request(proxyPort, '/')).body.toString(), 'B')
})

// --- Host allowlist (DNS-rebinding defence) ----------------------------------

test('requestHostname drops the port and IPv6 brackets, lowercased', () => {
  assert.equal(requestHostname('Example.COM:8443'), 'example.com')
  assert.equal(requestHostname('127.0.0.1'), '127.0.0.1')
  assert.equal(requestHostname('[::1]:3101'), '::1')
  assert.equal(requestHostname('[::1]'), '::1')
  assert.equal(requestHostname(undefined), '')
  assert.equal(requestHostname('[::1'), '')
})

test('isAllowedHost: loopback names always, plus the given hostnames', () => {
  for (const ok of ['127.0.0.1:3101', 'localhost:3101', 'LOCALHOST', '[::1]:3101']) assert.equal(isAllowedHost(ok, []), true, ok)
  assert.equal(isAllowedHost('qa.example.com:443', ['qa.example.com']), true)
  assert.equal(isAllowedHost('QA.example.com', [' qa.EXAMPLE.com ']), true)
  assert.equal(isAllowedHost('[fe80::1]:80', ['[fe80::1]']), true)
  for (const bad of ['attacker.example:3101', '127.0.0.1.attacker.example', '', undefined, 'localhost.evil']) {
    assert.equal(isAllowedHost(bad, ['qa.example.com']), false, String(bad))
  }
})

test('a request whose Host is not allowed gets 421 before anything else runs', async (t) => {
  let upstreamHits = 0
  let activity = 0
  const upstream = http.createServer((req, res) => { upstreamHits += 1; res.end('app') })
  const upstreamPort = await listen(upstream)
  const proxy = http.createServer(createPaneProxy({
    upstreamPort, bridgePath: '/nonexistent', onActivity: () => { activity += 1 }, httpMod: http, allowedHosts: ['pane.example.ts.net'],
  }))
  const proxyPort = await listen(proxy)
  t.after(async () => { for (const s of [upstream, proxy]) await new Promise(r => s.close(r)) })

  const rebound = await request(proxyPort, '/', { headers: { host: `attacker.example:${proxyPort}` } })
  assert.equal(rebound.status, 421)
  assert.equal(rebound.headers['content-security-policy'], "frame-ancestors 'self'", 'the 421 carries the pane policy too')
  const bridge = await request(proxyPort, '/__qa/bridge.js', { headers: { host: 'attacker.example' } })
  assert.equal(bridge.status, 421, 'checked before routing, bridge route included')
  assert.equal(upstreamHits, 0)
  assert.equal(activity, 0, 'a rejected request is not activity')

  assert.equal((await request(proxyPort, '/', { headers: { host: 'pane.example.ts.net:8443' } })).body.toString(), 'app')
  assert.equal((await request(proxyPort, '/')).body.toString(), 'app', 'loopback Host is always allowed')
})

test('allowedHosts may be a function, resolved per request; default is loopback only', async (t) => {
  let hosts = []
  const lazy = http.createServer(createPaneProxy({ upstreamPort: () => null, bridgePath: '/nonexistent', httpMod: http, allowedHosts: () => hosts }))
  const plain = http.createServer(createPaneProxy({ upstreamPort: () => null, bridgePath: '/nonexistent', httpMod: http }))
  const lazyPort = await listen(lazy)
  const plainPort = await listen(plain)
  t.after(async () => { for (const s of [lazy, plain]) await new Promise(r => s.close(r)) })
  assert.equal((await request(lazyPort, '/', { headers: { host: 'late.example' } })).status, 421)
  hosts = ['late.example']
  assert.equal((await request(lazyPort, '/', { headers: { host: 'late.example' } })).status, 503)
  assert.equal((await request(plainPort, '/', { headers: { host: 'late.example' } })).status, 421)
  assert.equal((await request(plainPort, '/')).status, 503)
})

test('no upstream (no session) yields a 503, not a connection attempt', async (t) => {
  const proxy = http.createServer(createPaneProxy({ upstreamPort: () => null, bridgePath: '/nonexistent', httpMod: http }))
  const proxyPort = await listen(proxy)
  t.after(() => new Promise(r => proxy.close(r)))
  const res = await request(proxyPort, '/dashboard')
  assert.equal(res.status, 503)
  assert.match(res.body.toString(), /no QA session/)
})


// --- other pages ----------------------------------------------------------------
// The jar signs every request in as the operator, and a front door that
// authenticates the device vouches for any page in the operator's browser, so
// the app's SameSite cookies protect nothing here. ts.net is on the Public
// Suffix List, and loopback ignores ports: every other host or port is
// same-site, so same-site is refused like cross-site.

const FRAME_ANCESTORS = `frame-ancestors 'self' ${HARNESS}`
const PANE_HOST = { host: 'h.ts.net:10000' }
const MALLORY = 'https://mallory.tail1234.ts.net'
// The pane's own hostname must pass the Host allowlist.
const GUARDED = { harnessOrigin: HARNESS, allowedHosts: ['h.ts.net'] }

test('writes from another page never reach the app; the pane itself and curl still write', async (t) => {
  const seen = []
  const { proxyPort, activity } = await setup(t, (req, res) => { seen.push(req.method); res.end('ok') }, GUARDED)
  for (const headers of [
    { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
    { 'sec-fetch-site': 'same-site', origin: MALLORY },
    { 'sec-fetch-site': 'same-site', origin: HARNESS },
    { origin: MALLORY },
    { origin: 'null' },
  ]) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await request(proxyPort, '/api/x', { method, headers: { ...PANE_HOST, 'content-type': 'text/plain', ...headers }, body: 'x' })
      assert.equal(res.status, 403, `${method} ${JSON.stringify(headers)}`)
      assert.match(res.body.toString(), /cross-site request refused/)
      assert.equal(res.headers['content-security-policy'], FRAME_ANCESTORS)
      assert.equal(res.headers['x-content-type-options'], 'nosniff')
      assert.equal(res.headers['cache-control'], 'no-store')
    }
  }
  assert.deepEqual(seen, [])
  assert.equal(activity.count, 0, 'refused requests are not activity')
  for (const headers of [
    { 'sec-fetch-site': 'same-origin', origin: 'https://h.ts.net:10000' },
    { origin: 'https://h.ts.net:10000' },
    { 'sec-fetch-site': 'none' },
    {},
  ]) {
    const res = await request(proxyPort, '/api/x', { method: 'POST', headers: { ...PANE_HOST, ...headers }, body: 'x' })
    assert.equal(res.status, 200, JSON.stringify(headers))
  }
  assert.deepEqual(seen, ['POST', 'POST', 'POST', 'POST'])
})

test('CORS preflights, CORS reads and WebSockets from another origin are refused', async (t) => {
  const seen = []
  const { proxyPort } = await setup(t, (req, res) => { seen.push(req.method); res.end('ok') }, GUARDED)
  for (const [method, headers] of [
    ['OPTIONS', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors', origin: MALLORY, 'access-control-request-method': 'POST' }],
    ['OPTIONS', { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' }],
    ['GET', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors', origin: MALLORY }],
    ['GET', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', origin: 'https://evil.example' }],
    ['GET', { origin: 'https://evil.example' }],
    ['GET', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'websocket', origin: MALLORY }],
  ]) {
    const res = await request(proxyPort, '/api/me', { method, headers: { ...PANE_HOST, ...headers } })
    assert.equal(res.status, 403, `${method} ${JSON.stringify(headers)}`)
  }
  assert.deepEqual(seen, [])
  // the pane's own fetches, and a preflight-shaped request from curl
  assert.equal((await request(proxyPort, '/api/me', { headers: { ...PANE_HOST, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' } })).status, 200)
  assert.equal((await request(proxyPort, '/api/me', { method: 'OPTIONS', headers: PANE_HOST })).status, 200)
})

// The browser sends the harness origin as the Referer when the harness loads
// a pane in its iframe, or opens it in a new tab (same-site: another port of
// the same host).
const FROM_HARNESS = { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', referer: `${HARNESS}/` }

test('another site may not load a pane in a frame; the harness may, and the pane itself', async (t) => {
  const seen = []
  const { proxyPort, activity } = await setup(t, (req, res) => { seen.push(req.url); res.end('ok') }, GUARDED)
  for (const dest of ['iframe', 'frame', 'embed', 'object']) {
    for (const headers of [
      { 'sec-fetch-site': 'cross-site', referer: 'https://evil.example/' },
      { 'sec-fetch-site': 'same-site', referer: `${MALLORY}/` },
      // no Referer (rel=noreferrer, or a no-referrer policy) proves nothing
      { 'sec-fetch-site': 'same-site' },
      { 'sec-fetch-site': 'same-site', referer: 'not a url' },
      { 'sec-fetch-site': 'same-site', referer: 'https://h.ts.net:8445/' },
    ]) {
      const res = await request(proxyPort, '/settings', { headers: { ...PANE_HOST, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': dest, ...headers } })
      assert.equal(res.status, 403, `${dest} ${JSON.stringify(headers)}`)
      assert.match(res.body.toString(), /cross-site framing refused/)
      assert.equal(res.headers['content-security-policy'], FRAME_ANCESTORS)
    }
  }
  assert.deepEqual(seen, [])
  assert.equal(activity.count, 0)
  for (const headers of [
    // the harness's iframe, the reload button and resync, and an older browser's nested-navigate
    { ...FROM_HARNESS, 'sec-fetch-dest': 'iframe' },
    { ...FROM_HARNESS, 'sec-fetch-dest': 'iframe', referer: `${HARNESS}/qa` },
    { ...FROM_HARNESS, 'sec-fetch-mode': 'nested-navigate', 'sec-fetch-dest': 'iframe' },
    // the pane's own links and forms inside the frame
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' },
  ]) {
    assert.equal((await request(proxyPort, '/x', { headers: { ...PANE_HOST, ...headers } })).status, 200, JSON.stringify(headers))
  }
})

test('another site may not open a pane top-level; the harness\'s new tab and the operator\'s own are served', async (t) => {
  const seen = []
  const { proxyPort } = await setup(t, (req, res) => { seen.push(req.url); res.end('ok') }, GUARDED)
  for (const headers of [
    // a link, a redirect or window.open on another site or tailnet host
    { 'sec-fetch-site': 'cross-site', referer: 'https://evil.example/' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site', referer: `${MALLORY}/` },
    { 'sec-fetch-site': 'same-site' },
  ]) {
    const res = await request(proxyPort, '/account/delete?confirm=1', {
      headers: { ...PANE_HOST, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', ...headers },
    })
    assert.equal(res.status, 403, JSON.stringify(headers))
    assert.match(res.body.toString(), /cross-site navigation refused/)
  }
  assert.deepEqual(seen, [])
  for (const headers of [
    // the harness's "Open in new tab"
    { ...FROM_HARNESS, 'sec-fetch-dest': 'document' },
    // typed, bookmarked or reloaded by the operator
    { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    // curl, or a browser that sends no Sec-Fetch-* headers
    {},
  ]) {
    assert.equal((await request(proxyPort, '/x', { headers: { ...PANE_HOST, ...headers } })).status, 200, JSON.stringify(headers))
  }
})

// The other page can't read these, but the app handles each one as the
// operator: a GET that changes state, or a probe that times the operator's
// pane session.
test('subresource loads from another page never reach the app; the pane\'s own are served', async (t) => {
  const seen = []
  const { proxyPort, activity } = await setup(t, (req, res) => { seen.push(req.url); res.end('ok') }, GUARDED)
  for (const site of ['cross-site', 'same-site']) {
    for (const [mode, dest] of [
      ['no-cors', 'image'], ['no-cors', 'script'], ['no-cors', 'style'], ['no-cors', 'font'],
      ['no-cors', 'empty'], ['no-cors', 'audio'], ['no-cors', 'video'], ['no-cors', 'track'],
      ['same-origin', 'empty'],
    ]) {
      for (const referer of [undefined, `${HARNESS}/`]) {
        const headers = { ...PANE_HOST, 'sec-fetch-site': site, 'sec-fetch-mode': mode, 'sec-fetch-dest': dest, ...(referer ? { referer } : {}) }
        const res = await request(proxyPort, '/api/delete-everything', { headers })
        assert.equal(res.status, 403, JSON.stringify(headers))
        assert.match(res.body.toString(), /cross-site request refused/)
      }
    }
  }
  assert.deepEqual(seen, [])
  assert.equal(activity.count, 0)
  for (const [mode, dest] of [['no-cors', 'image'], ['no-cors', 'script'], ['no-cors', 'style'], ['cors', 'empty']]) {
    const res = await request(proxyPort, '/asset', { headers: { ...PANE_HOST, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': mode, 'sec-fetch-dest': dest } })
    assert.equal(res.status, 200, `${mode} ${dest}`)
  }
})

test('without a harness origin nothing from another site gets in, and the operator\'s own navigations still do', async (t) => {
  const seen = []
  const { proxyPort } = await setup(t, (req, res) => { seen.push(req.url); res.end('ok') }, { allowedHosts: ['h.ts.net'] })
  for (const dest of ['iframe', 'document']) {
    assert.equal((await request(proxyPort, '/x', { headers: { ...PANE_HOST, ...FROM_HARNESS, 'sec-fetch-dest': dest } })).status, 403, dest)
    // with no Referer either, the missing harness origin must not match the
    // missing Referer
    for (const site of ['same-site', 'cross-site']) {
      const headers = { ...PANE_HOST, 'sec-fetch-site': site, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': dest }
      assert.equal((await request(proxyPort, '/x', { headers })).status, 403, `${site} ${dest}, no Referer`)
    }
  }
  assert.deepEqual(seen, [])
  assert.equal((await request(proxyPort, '/x', { headers: { ...PANE_HOST, 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } })).status, 200)
})

test('every response lets only the pane and the harness frame it, replacing upstream framing rules', async (t) => {
  const bytes = Buffer.from([0, 1, 2, 255])
  const { proxyPort } = await setup(t, (req, res) => {
    if (req.url === '/page') {
      res.setHeader('content-type', 'text/html')
      res.setHeader('x-frame-options', 'DENY')
      res.setHeader('content-security-policy', "default-src 'self'; frame-ancestors 'none'; img-src *")
      res.end('<html><head></head><body>hi</body></html>')
    } else if (req.url === '/two') {
      // two policies in two headers: each keeps its other directives
      res.setHeader('content-type', 'text/plain')
      res.setHeader('content-security-policy', ["frame-ancestors 'none'", "script-src 'self'; FRAME-ANCESTORS https://evil.example"])
      res.end('two')
    } else if (req.url === '/redirect') {
      res.statusCode = 302
      res.setHeader('location', '/page')
      res.setHeader('x-frame-options', 'DENY')
      res.end()
    } else {
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('x-frame-options', 'SAMEORIGIN')
      res.end(bytes)
    }
  }, GUARDED)
  const get = path => request(proxyPort, path, { headers: PANE_HOST })
  const page = await get('/page')
  assert.equal(page.headers['x-frame-options'], undefined)
  assert.equal(page.headers['content-security-policy'], `default-src 'self'; img-src *, ${FRAME_ANCESTORS}`)
  const blob = await get('/blob')
  assert.deepEqual(blob.body, bytes)
  assert.equal(blob.headers['x-frame-options'], undefined)
  assert.equal(blob.headers['content-security-policy'], FRAME_ANCESTORS)
  assert.equal((await get('/two')).headers['content-security-policy'], `script-src 'self', ${FRAME_ANCESTORS}`)
  const redirect = await get('/redirect')
  assert.deepEqual([redirect.status, redirect.headers['x-frame-options'], redirect.headers['content-security-policy']], [302, undefined, FRAME_ANCESTORS])
  assert.equal((await get('/__qa/bridge.js')).headers['content-security-policy'], FRAME_ANCESTORS)
})

test('the injected bridge tag carries the harness origin, normalized to an origin', async (t) => {
  const { proxyPort } = await setup(t, (req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><head></head><body>hi</body></html>')
  }, { ...GUARDED, harnessOrigin: `${HARNESS}/qa/` })
  const res = await request(proxyPort, '/', { headers: PANE_HOST })
  assert.ok(res.body.toString().includes(`<script src="/__qa/bridge.js" data-harness="${HARNESS}"></script></head>`))
  assert.equal(res.headers['content-security-policy'], FRAME_ANCESTORS)
})

test('without a harness origin only the pane may frame itself', async (t) => {
  const { proxyPort } = await setup(t, (req, res) => res.end('ok'), { allowedHosts: ['h.ts.net'] })
  assert.equal((await request(proxyPort, '/', { headers: PANE_HOST })).headers['content-security-policy'], "frame-ancestors 'self'")
  const idle = http.createServer(createPaneProxy({ upstreamPort: () => null, bridgePath: '/nonexistent', httpMod: http, harnessOrigin: HARNESS }))
  const idlePort = await listen(idle)
  t.after(() => new Promise(r => idle.close(r)))
  const res = await request(idlePort, '/')
  assert.equal(res.status, 503)
  assert.equal(res.headers['content-security-policy'], FRAME_ANCESTORS)
})

// --- 0.3.0: the harness origin per request, extra frame ancestors, the jar -----

test('harnessOrigin and frameAncestors may be functions, resolved per request', async (t) => {
  let origin = null
  let extra = []
  const { proxyPort } = await setup(t, (req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><head></head><body>hi</body></html>')
  }, { allowedHosts: ['h.ts.net'], harnessOrigin: () => origin, frameAncestors: () => extra })
  const frame = { ...PANE_HOST, ...FROM_HARNESS, 'sec-fetch-dest': 'iframe' }

  const before = await request(proxyPort, '/', { headers: PANE_HOST })
  assert.equal(before.headers['content-security-policy'], "frame-ancestors 'self'")
  assert.ok(before.body.toString().includes(`${BRIDGE_TAG}</head>`))
  assert.equal((await request(proxyPort, '/', { headers: frame })).status, 403, 'no harness origin yet')

  origin = HARNESS
  extra = ['https://outer.ts.net:8444']
  const after = await request(proxyPort, '/', { headers: PANE_HOST })
  assert.equal(after.headers['content-security-policy'], `${FRAME_ANCESTORS} https://outer.ts.net:8444`)
  assert.ok(after.body.toString().includes(`${tagFor(HARNESS)}</head>`))
  assert.equal((await request(proxyPort, '/', { headers: frame })).status, 200)
  // only the harness origin's Referer admits a navigation: the extra
  // ancestors are CSP only
  const fromOuter = { ...frame, referer: 'https://outer.ts.net:8444/' }
  assert.equal((await request(proxyPort, '/', { headers: fromOuter })).status, 403)
})

test('extra frame ancestors follow the harness origin; a value that is not an http(s) origin is dropped, file: and data: URLs included (no "null" source, no data-harness="null")', async (t) => {
  const junk = ['file:///x', 'data:text/html,x', '*', "'self'", 'https://a;b', 'javascript:alert(1)', 'not a url', '', null, 42]
  assert.equal(panePolicy(HARNESS, ['https://Outer.ts.net:8444/qa/', ...junk]), `${FRAME_ANCESTORS} https://outer.ts.net:8444`)
  assert.equal(panePolicy(`${HARNESS}/`, [HARNESS]), FRAME_ANCESTORS, 'listed once')
  assert.equal(panePolicy(), "frame-ancestors 'self'")
  assert.equal(panePolicy(null, 'https://outer.ts.net:8444'), "frame-ancestors 'self' https://outer.ts.net:8444", 'a single string')
  for (const bad of ['file:///x', 'data:text/html,x']) assert.equal(panePolicy(bad, [bad]), "frame-ancestors 'self'", bad)
  // an IPv6 literal can't be a CSP source: left out, still the bridge's target
  assert.equal(panePolicy('http://[::1]:3100', ['http://[::1]:3200']), "frame-ancestors 'self'")

  for (const harnessOrigin of ['file:///x', 'data:text/html,x', 'not an origin']) {
    const { proxyPort } = await setup(t, (req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<html><head></head><body>hi</body></html>')
    }, { harnessOrigin, frameAncestors: ['data:text/html,x'] })
    const res = await request(proxyPort, '/')
    assert.equal(res.headers['content-security-policy'], "frame-ancestors 'self'", harnessOrigin)
    assert.ok(res.body.toString().includes(`${BRIDGE_TAG}</head>`), harnessOrigin)
    assert.doesNotMatch(res.body.toString() + res.headers['content-security-policy'], /null/)
  }
  const { proxyPort } = await setup(t, (req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><head></head><body>hi</body></html>')
  }, { harnessOrigin: 'http://[::1]:3100' })
  assert.ok((await request(proxyPort, '/')).body.toString().includes(`${tagFor('http://[::1]:3100')}</head>`))
})

// The jar no longer filters by SameSite: after the guard, the only requests it
// filtered were the harness's own iframe loads when the harness and the panes
// are on different sites, and filtering those signed the pane out.
test('a request the harness Referer admits gets the whole jar', async (t) => {
  const harnessOrigin = 'http://localhost:4100'
  const { proxyPort } = await setup(t, (req, res) => {
    if (req.url === '/login') {
      res.setHeader('set-cookie', ['lax=1; SameSite=Lax', 'strict=1; SameSite=Strict; HttpOnly', 'none=1; SameSite=None; Secure', 'plain=1'])
    }
    res.end(req.headers.cookie ?? '')
  }, { harnessOrigin })
  await request(proxyPort, '/login')
  const all = 'lax=1; strict=1; none=1; plain=1'
  for (const [site, dest] of [['cross-site', 'iframe'], ['cross-site', 'document'], ['same-site', 'iframe']]) {
    const headers = { 'sec-fetch-site': site, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': dest, referer: `${harnessOrigin}/` }
    const res = await request(proxyPort, '/echo', { headers })
    assert.deepEqual([res.status, res.body.toString()], [200, all], `${site} ${dest}`)
  }
  // and every other admitted request, as before
  for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }, {}]) {
    assert.equal((await request(proxyPort, '/echo', { headers })).body.toString(), all, JSON.stringify(headers))
  }
})

// A redirect's own Referrer-Policy sets the Referer of the request it leads to.
// The harness's Referer is what admits the next hop, so an app's no-referrer
// (helmet's default) or same-origin (Django's) on a redirect within the pane
// would get the app's own redirect refused: a magic-link landing that
// redirects home, or a trailing-slash redirect on resync.
test('a redirect that stays on the pane drops the app\'s Referrer-Policy; a redirect elsewhere and other responses keep it', async (t) => {
  let upstreamPortRef
  const { upstreamPort, proxyPort } = await setup(t, (req, res) => {
    const to = new URL(req.url, 'http://x').searchParams.get('to')
    res.setHeader('referrer-policy', 'no-referrer')
    if (to === null) return res.end('page')
    if (to === 'created') {
      res.statusCode = 201
      res.setHeader('location', '/home')
      return res.end()
    }
    res.statusCode = to === 'rel' ? 301 : 302
    res.setHeader('location', {
      rel: '/home',
      bare: 'home',
      query: '?next=1',
      upstream: `http://127.0.0.1:${upstreamPortRef}/home`,
      pane: 'https://h.ts.net:10000/home',
      paneUpper: 'https://H.TS.NET:10000/home',
      foreign: 'https://example.com/x',
      schemeRelative: '//evil.example/x',
      backslash: '/\\evil.example/x',
      otherPort: 'https://h.ts.net:8443/x',
    }[to])
    res.end()
  }, GUARDED)
  upstreamPortRef = upstreamPort
  const frame = { ...PANE_HOST, ...FROM_HARNESS, 'sec-fetch-dest': 'iframe' }
  const policyOf = async to => {
    const res = await request(proxyPort, `/landing?to=${to}`, { headers: frame })
    assert.ok(res.status >= 300 && res.status < 400, `${to}: ${res.status}`)
    return res.headers['referrer-policy']
  }
  for (const to of ['rel', 'bare', 'query', 'upstream', 'pane', 'paneUpper']) {
    assert.equal(await policyOf(to), undefined, to)
  }
  for (const to of ['foreign', 'schemeRelative', 'backslash', 'otherPort']) {
    assert.equal(await policyOf(to), 'no-referrer', to)
  }
  // a page keeps its policy: it governs the requests that page makes
  assert.equal((await request(proxyPort, '/page', { headers: frame })).headers['referrer-policy'], 'no-referrer')
  // so does a non-redirect whose Location stays on the pane (201 Created): only
  // a 3xx leads the browser to another request under its own policy
  const created = await request(proxyPort, '/landing?to=created', { headers: frame })
  assert.equal(created.status, 201)
  assert.equal(created.headers['referrer-policy'], 'no-referrer')
})
