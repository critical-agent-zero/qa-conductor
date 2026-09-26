// Pane proxy for QA sessions. Fronts one pane's app container:
//
// - Holds the pane's cookies in a server-side jar. Cookies ignore ports, so
//   two app versions behind one tailnet hostname would collide in the
//   browser; pane Set-Cookie headers are absorbed here and never forwarded.
// - Injects the mirror bridge <script> into text/html responses and serves
//   the bridge file at /__qa/bridge.js (read per request, no cache).
// - Stamps activity (onActivity) for the idle reaper.
// - Rewrites absolute http://127.0.0.1:<upstreamPort> Locations to relative
//   so redirects stay on the pane's public origin.
// - Answers 421 to any request whose Host isn't loopback or an allowed
//   hostname, before routing. Because the proxy holds the jar, a request that
//   reaches it IS a signed-in pane session; the Host check stops a DNS-rebound
//   page from driving it. The harness server reuses the same check.
// - Applies each jar cookie's SameSite as a browser would. The Host check
//   can't stop a site the reviewer visits from sending requests to a pane
//   through the reviewer's own browser, so a cross-site request only gets the
//   jar cookies a browser would have sent it (None; Lax on a top-level GET).
// - Sends a frame-ancestors policy limited to loopback and the allowed hosts
//   on every proxied response, so only the harness can frame a signed-in pane.

import http from 'node:http'
import { readFile } from 'node:fs/promises'

const BRIDGE_ROUTE = '/__qa/bridge.js'
const BRIDGE_TAG = '<script src="/__qa/bridge.js"></script>'
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1']
// A hostname a CSP host-source can carry: no IPv6 literal, wildcard or
// separator that would change the policy's meaning.
const CSP_HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/

const normalizeHost = h => String(h ?? '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')

// The hostname a request was addressed to: port dropped, IPv6 brackets
// stripped, lowercased. '' when the header is missing or malformed.
export function requestHostname(hostHeader) {
  const h = String(hostHeader ?? '').trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end === -1 ? '' : h.slice(1, end)
  }
  const colon = h.indexOf(':')
  return colon === -1 ? h : h.slice(0, colon)
}

// Loopback names are always allowed; `allowedHosts` adds more hostnames.
export function isAllowedHost(hostHeader, allowedHosts = []) {
  const name = requestHostname(hostHeader)
  if (!name) return false
  return LOOPBACK_HOSTS.includes(name) || allowedHosts.some(h => normalizeHost(h) === name)
}

export function misdirected(res) {
  res.writeHead(421, { 'content-type': 'text/plain' })
  res.end('421: unrecognised Host header')
}

// A browser request from another site. Uses sec-fetch-site when present, else
// the Origin's host checked against the allowlist (loopback always allowed).
export function isCrossSite(req, allowedHosts = []) {
  const site = req.headers['sec-fetch-site']
  if (site) return site === 'cross-site'
  const origin = req.headers.origin
  if (origin === undefined) return false // non-browser client or plain navigation
  let host
  try { host = new URL(origin).host } catch { return true } // 'null' or garbage
  return !isAllowedHost(host, allowedHosts)
}

// The CSP that lets only loopback and the allowed hosts (where the harness is
// served) frame a pane. IPv6 literals can't be expressed and are left out.
export function frameAncestors(hosts = []) {
  const names = new Set(['127.0.0.1', 'localhost'])
  for (const h of hosts) {
    const name = normalizeHost(h)
    if (CSP_HOSTNAME.test(name)) names.add(name)
  }
  return `frame-ancestors 'self' ${[...names].map(n => `http://${n}:* https://${n}:*`).join(' ')}`
}

// Parse one Set-Cookie header into { name, value, remove, sameSite }. A cookie
// is a removal when Max-Age <= 0, Expires is in the past (Max-Age wins when
// both are present, per RFC 6265), or the value is empty / the conventional
// 'deleted' sentinel. sameSite is 'strict' | 'lax' | 'none', defaulting to
// 'lax' as browsers do; browsers reject None without Secure, so such a cookie
// is kept as 'lax' rather than sent cross-site.
export function parseSetCookie(header) {
  const [pair, ...attrs] = String(header).split(';')
  const eq = pair.indexOf('=')
  const name = (eq === -1 ? pair : pair.slice(0, eq)).trim()
  const value = eq === -1 ? '' : pair.slice(eq + 1).trim()
  let maxAge = null
  let expires = null
  let sameSite = 'lax'
  let secure = false
  for (const attr of attrs) {
    const i = attr.indexOf('=')
    const key = (i === -1 ? attr : attr.slice(0, i)).trim().toLowerCase()
    const v = i === -1 ? '' : attr.slice(i + 1).trim()
    if (key === 'max-age') maxAge = Number(v)
    else if (key === 'expires') expires = Date.parse(v)
    else if (key === 'secure') secure = true
    else if (key === 'samesite') {
      const s = v.toLowerCase()
      sameSite = s === 'strict' || s === 'none' ? s : 'lax'
    }
  }
  if (sameSite === 'none' && !secure) sameSite = 'lax'
  let remove = value === '' || value === 'deleted'
  if (maxAge !== null && !Number.isNaN(maxAge)) {
    if (maxAge <= 0) remove = true
  } else if (expires !== null && !Number.isNaN(expires) && expires <= Date.now()) {
    remove = true
  }
  return { name, value, remove, sameSite }
}

// The jar cookies a browser would attach to this request: all of them unless
// it is cross-site, then only None ones, plus Lax ones on a top-level GET.
function jarFor(req, jar, allowedHosts) {
  if (!isCrossSite(req, allowedHosts)) return jar
  const topNav = (req.method === 'GET' || req.method === 'HEAD') &&
    req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document'
  return new Map([...jar].filter(([, c]) => c.sameSite === 'none' || (c.sameSite === 'lax' && topNav)))
}

// The client's own Cookie header is kept: the browser already applied
// SameSite to it.
function mergeCookieHeader(clientCookie, jar) {
  const merged = new Map()
  if (clientCookie) {
    for (const part of String(clientCookie).split(';')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      merged.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
    }
  }
  for (const [name, c] of jar) merged.set(name, c.value)
  return [...merged].map(([name, value]) => `${name}=${value}`).join('; ')
}

function upstreamHeaders(req, jar) {
  const headers = {}
  for (const [key, value] of Object.entries(req.headers)) {
    const k = key.toLowerCase()
    if (k === 'host' || k === 'accept-encoding' || k === 'cookie') continue
    if (k === 'connection' || k === 'keep-alive' || k === 'proxy-connection') continue
    headers[k] = value
  }
  headers['accept-encoding'] = 'identity'
  const cookie = mergeCookieHeader(req.headers.cookie, jar)
  if (cookie) headers.cookie = cookie
  return headers
}

function responseHeaders(upRes, upstreamPort) {
  const headers = {}
  for (const [key, value] of Object.entries(upRes.headers)) {
    const k = key.toLowerCase()
    if (k === 'set-cookie' || k === 'transfer-encoding' || k === 'connection' || k === 'keep-alive') {
      continue
    }
    headers[k] = value
  }
  const origin = `http://127.0.0.1:${upstreamPort}`
  if (typeof headers.location === 'string' && headers.location.startsWith(origin)) {
    const rest = headers.location.slice(origin.length)
    if (rest === '') headers.location = '/'
    else if (rest.startsWith('/')) headers.location = rest
    else if (rest.startsWith('?') || rest.startsWith('#')) headers.location = `/${rest}`
    // anything else (e.g. a longer port sharing the prefix) is left untouched
  }
  return headers
}

function injectBridge(body) {
  const html = body.toString('utf8')
  const match = /<\/head>/i.exec(html)
  const injected = match
    ? html.slice(0, match.index) + BRIDGE_TAG + html.slice(match.index)
    : BRIDGE_TAG + html
  return Buffer.from(injected, 'utf8')
}

function serveBridge(bridgePath, res) {
  readFile(bridgePath).then(
    (content) => {
      res.writeHead(200, { 'content-type': 'text/javascript', 'content-length': content.length })
      res.end(content)
    },
    () => {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('bridge script not found')
    },
  )
}

export function createPaneProxy({ upstreamPort, bridgePath, onActivity = () => {}, httpMod = http, allowedHosts = [] }) {
  // name -> { value, sameSite }
  const jar = new Map()
  // A number, or a function resolved per request: the conductor points the
  // pane at whatever port the Provisioner reserved for the running session.
  const portOf = typeof upstreamPort === 'function' ? upstreamPort : () => upstreamPort
  // Likewise: the conductor's pane origins may be assigned after start.
  const hostsOf = typeof allowedHosts === 'function' ? allowedHosts : () => allowedHosts

  return function handler(req, res) {
    if (!isAllowedHost(req.headers.host, hostsOf())) return misdirected(res)
    const pathname = (req.url ?? '/').split('?')[0]
    if (req.method === 'GET' && pathname === BRIDGE_ROUTE) {
      serveBridge(bridgePath, res)
      return
    }

    onActivity()

    const port = portOf()
    if (!port) {
      res.writeHead(503, { 'content-type': 'text/plain' })
      res.end('503: no QA session is running on this pane')
      return
    }

    const upReq = httpMod.request(
      {
        host: '127.0.0.1',
        port,
        method: req.method,
        path: req.url,
        headers: upstreamHeaders(req, jarFor(req, jar, hostsOf())),
      },
      (upRes) => {
        const rawSetCookies = upRes.headers['set-cookie'] ?? []
        for (const raw of Array.isArray(rawSetCookies) ? rawSetCookies : [rawSetCookies]) {
          const { name, value, remove, sameSite } = parseSetCookie(raw)
          if (!name) continue
          if (remove) jar.delete(name)
          else jar.set(name, { value, sameSite })
        }

        const headers = responseHeaders(upRes, port)
        // Appended, not replaced: browsers enforce each CSP header on its own,
        // so the app's own policy still applies alongside this one.
        const fa = frameAncestors(hostsOf())
        const prev = headers['content-security-policy']
        headers['content-security-policy'] = prev ? [].concat(prev, fa) : fa
        const isHtml = /^text\/html\b/i.test(upRes.headers['content-type'] ?? '')
        if (!isHtml) {
          res.writeHead(upRes.statusCode ?? 502, headers)
          upRes.pipe(res)
          return
        }

        const chunks = []
        upRes.on('data', (chunk) => chunks.push(chunk))
        upRes.on('end', () => {
          const body = injectBridge(Buffer.concat(chunks))
          headers['content-length'] = body.length
          res.writeHead(upRes.statusCode ?? 502, headers)
          res.end(body)
        })
      },
    )

    upReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
      res.end('502: QA pane upstream unavailable')
    })

    req.pipe(upReq)
  }
}
