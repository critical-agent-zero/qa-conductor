import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPaneProxy, parseSetCookie, requestHostname, isAllowedHost, isCrossSite, frameAncestors,
} from '../lib/proxy.mjs'

const BRIDGE_TAG = '<script src="/__qa/bridge.js"></script>'

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

async function setup(t, upstreamHandler, { allowedHosts = [] } = {}) {
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
  })
  const proxy = http.createServer(handler)
  const proxyPort = await listen(proxy)
  t.after(async () => {
    await new Promise((r) => upstream.close(r))
    await new Promise((r) => proxy.close(r))
    await rm(dir, { recursive: true, force: true })
  })
  return { upstreamPort, proxyPort, activity, bridgePath }
}

// --- parseSetCookie -------------------------------------------------------

test('parseSetCookie: plain name=value', () => {
  assert.deepEqual(parseSetCookie('sid=abc123'), { name: 'sid', value: 'abc123', remove: false, sameSite: 'lax' })
})

test('parseSetCookie: ignores other attributes, keeps value with embedded =', () => {
  const parsed = parseSetCookie('sid=a=b=c; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600')
  assert.deepEqual(parsed, { name: 'sid', value: 'a=b=c', remove: false, sameSite: 'strict' })
})

test('parseSetCookie: SameSite defaults to lax; None needs Secure', () => {
  assert.equal(parseSetCookie('a=1').sameSite, 'lax')
  assert.equal(parseSetCookie('a=1; samesite=LAX').sameSite, 'lax')
  assert.equal(parseSetCookie('a=1; SameSite=Strict').sameSite, 'strict')
  assert.equal(parseSetCookie('a=1; SameSite=None; Secure').sameSite, 'none')
  assert.equal(parseSetCookie('a=1; SameSite=None').sameSite, 'lax', 'browsers reject None without Secure')
  assert.equal(parseSetCookie('a=1; SameSite=bogus').sameSite, 'lax')
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

test('merges client cookies with the jar, jar wins on conflicts', async (t) => {
  let seenCookie
  const { proxyPort } = await setup(t, (req, res) => {
    if (req.url === '/prime') {
      res.setHeader('set-cookie', 'sid=abc')
    } else {
      seenCookie = req.headers.cookie
    }
    res.end('ok')
  })
  await request(proxyPort, '/prime')
  await request(proxyPort, '/page', { headers: { cookie: 'sid=client; other=1' } })
  const pairs = seenCookie.split('; ').sort()
  assert.deepEqual(pairs, ['other=1', 'sid=abc'])
})

// --- HTML injection -------------------------------------------------------

test('injects the bridge script before </head> (case-insensitive) and fixes Content-Length', async (t) => {
  const page = '<html><HEAD><title>x</title></HEAD><body>hi</body></html>'
  const { proxyPort } = await setup(t, (req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(page)
  })
  const res = await request(proxyPort, '/')
  const html = res.body.toString()
  assert.ok(html.includes(`${BRIDGE_TAG}</HEAD>`), 'script goes immediately before </head>')
  assert.equal(html.split(BRIDGE_TAG).length - 1, 1, 'injected exactly once')
  assert.equal(Number(res.headers['content-length']), res.body.length)
})

test('HTML without </head> gets the script prepended to the body start', async (t) => {
  const { proxyPort } = await setup(t, (req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<p>bare fragment</p>')
  })
  const res = await request(proxyPort, '/')
  const html = res.body.toString()
  assert.ok(html.startsWith(BRIDGE_TAG))
  assert.ok(html.endsWith('<p>bare fragment</p>'))
  assert.equal(Number(res.headers['content-length']), res.body.length)
})

test('injects into HTML responses of any status', async (t) => {
  const { proxyPort } = await setup(t, (req, res) => {
    res.statusCode = 404
    res.setHeader('content-type', 'text/html')
    res.end('<html><head></head><body>not found</body></html>')
  })
  const res = await request(proxyPort, '/missing')
  assert.equal(res.status, 404)
  assert.ok(res.body.toString().includes(`${BRIDGE_TAG}</head>`))
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
    createPaneProxy({ upstreamPort: deadPort, bridgePath, onActivity: () => {}, httpMod: http }),
  )
  const proxyPort = await listen(proxy)
  t.after(async () => {
    await new Promise((r) => proxy.close(r))
    await rm(dir, { recursive: true, force: true })
  })
  const res = await request(proxyPort, '/')
  assert.equal(res.status, 502)
  assert.ok(res.body.length > 0)
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

// --- SameSite for the jar (cross-site request defence) ------------------------

test('isCrossSite: sec-fetch-site wins, else the Origin host against the allowlist', () => {
  const r = headers => ({ headers })
  assert.equal(isCrossSite(r({ 'sec-fetch-site': 'cross-site' })), true)
  for (const site of ['same-origin', 'same-site', 'none']) {
    assert.equal(isCrossSite(r({ 'sec-fetch-site': site, origin: 'https://evil.example' })), false, site)
  }
  assert.equal(isCrossSite(r({})), false, 'no browser headers: a non-browser client')
  assert.equal(isCrossSite(r({ origin: 'https://evil.example' })), true)
  assert.equal(isCrossSite(r({ origin: 'null' })), true)
  assert.equal(isCrossSite(r({ origin: 'not a url' })), true)
  assert.equal(isCrossSite(r({ origin: 'http://127.0.0.1:3100' })), false, 'loopback is always allowed')
  assert.equal(isCrossSite(r({ origin: 'https://qa.example.ts.net' }), ['qa.example.ts.net']), false)
  assert.equal(isCrossSite(r({ origin: 'https://qa.example.ts.net' }), []), true)
})

test('a cross-site request gets only the jar cookies a browser would have sent', async (t) => {
  const { proxyPort } = await setup(t, (req, res) => {
    if (req.url === '/login') {
      res.setHeader('set-cookie', ['lax=1; SameSite=Lax', 'strict=1; SameSite=Strict; HttpOnly', 'none=1; SameSite=None; Secure'])
    }
    res.end(req.headers.cookie ?? '')
  }, { allowedHosts: ['qa.example.ts.net'] })
  await request(proxyPort, '/login')
  const seen = async (method, headers) => (await request(proxyPort, '/echo', { method, headers })).body.toString()
  const form = { 'content-type': 'application/x-www-form-urlencoded' }
  const nav = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }

  // cross-site writes: no Lax/Strict jar cookie, however it is detected
  assert.equal(await seen('POST', { ...form, ...nav, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), 'none=1')
  assert.equal(await seen('POST', { ...form, origin: 'https://evil.example' }), 'none=1')
  assert.equal(await seen('POST', { ...form, origin: 'null' }), 'none=1')
  // cross-site reads: Lax only on a top-level navigation
  assert.equal(await seen('GET', { ...nav, 'sec-fetch-site': 'cross-site' }), 'lax=1; none=1')
  assert.equal(await seen('GET', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }), 'none=1', 'a frame is not top-level')
  assert.equal(await seen('GET', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }), 'none=1')
  // the browser's own cookies pass through: it already applied SameSite
  assert.equal(await seen('POST', { ...form, 'sec-fetch-site': 'cross-site', cookie: 'mine=1' }), 'mine=1; none=1')

  const all = 'lax=1; strict=1; none=1'
  for (const site of ['same-origin', 'same-site', 'none']) {
    assert.equal(await seen('POST', { ...form, 'sec-fetch-site': site }), all, site)
  }
  assert.equal(await seen('POST', form), all, 'no browser headers')
  assert.equal(await seen('POST', { ...form, origin: 'https://qa.example.ts.net' }), all, 'an allowed-host Origin')
})

// --- frame lock ----------------------------------------------------------------

// Each Content-Security-Policy header as sent (res.headers would join them).
function cspValues(res) {
  const out = []
  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    if (res.rawHeaders[i].toLowerCase() === 'content-security-policy') out.push(res.rawHeaders[i + 1])
  }
  return out
}

test('frameAncestors: loopback plus the allowed hosts; IPv6 literals and non-hostnames left out', () => {
  const fa = frameAncestors([' QA.example.ts.net ', '[fe80::1]', '::1', "evil.example 'unsafe-inline'; script-src *", '*.evil.example', 'localhost'])
  assert.equal(fa, "frame-ancestors 'self' http://127.0.0.1:* https://127.0.0.1:* http://localhost:* https://localhost:* http://qa.example.ts.net:* https://qa.example.ts.net:*")
  assert.equal(frameAncestors(), "frame-ancestors 'self' http://127.0.0.1:* https://127.0.0.1:* http://localhost:* https://localhost:*")
})

test('every proxied response carries the frame-ancestors policy; an upstream CSP is kept', async (t) => {
  let hosts = ['qa.example.ts.net']
  const upstream = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.setHeader('content-type', 'text/html')
      res.setHeader('content-security-policy', "default-src 'self'")
      return res.end('<html><head></head><body>x</body></html>')
    }
    if (req.url === '/redirect') {
      res.statusCode = 302
      res.setHeader('location', '/page')
      return res.end()
    }
    res.setHeader('content-type', 'application/json')
    res.end('{}')
  })
  const upstreamPort = await listen(upstream)
  const proxy = http.createServer(createPaneProxy({ upstreamPort, bridgePath: '/nonexistent', httpMod: http, allowedHosts: () => hosts }))
  const proxyPort = await listen(proxy)
  t.after(async () => { for (const s of [upstream, proxy]) await new Promise(r => s.close(r)) })

  const page = await request(proxyPort, '/page')
  assert.deepEqual(cspValues(page), ["default-src 'self'", frameAncestors(hosts)], 'HTML: both policies, as separate headers')
  assert.match(frameAncestors(hosts), /https:\/\/qa\.example\.ts\.net:\*/)
  assert.deepEqual(cspValues(await request(proxyPort, '/data')), [frameAncestors(hosts)], 'piped responses too')
  assert.deepEqual(cspValues(await request(proxyPort, '/redirect')), [frameAncestors(hosts)], 'and redirects')
  // the hosts are read per request, like the Host allowlist
  hosts = ['late.example']
  assert.deepEqual(cspValues(await request(proxyPort, '/data')), [frameAncestors(['late.example'])])
})
