// Pane proxy for QA sessions. Fronts one pane's app container:
//
// - Holds the pane's cookies in a server-side jar. Cookies ignore ports, so
//   two app versions behind one tailnet hostname would collide in the
//   browser; pane Set-Cookie headers are absorbed here and never forwarded.
// - Injects the mirror bridge <script> into text/html responses and serves
//   the bridge file at /__qa/bridge.js (read per request, no cache). The tag
//   carries the harness origin (data-harness), the only origin the bridge
//   talks to.
// - Stamps activity (onActivity) for the idle reaper.
// - Rewrites absolute http://127.0.0.1:<upstreamPort> Locations to relative
//   so redirects stay on the pane's public origin.
// - Answers 421 to any request whose Host isn't loopback or an allowed
//   hostname, before routing: a DNS-rebound page must not drive a signed-in
//   pane. The harness server reuses the same check.
// - Since the jar signs every request in as the operator, refuses requests
//   other pages make, and navigations from another site that the harness did
//   not start (lib/request-guard.mjs).
// - Decides who may frame the pane: every response it sends carries
//   `frame-ancestors 'self' <harness origin> <frameAncestors…>` in place of
//   the app's own frame-ancestors directive and X-Frame-Options.

import http from 'node:http'
import { readFile } from 'node:fs/promises'

import { webOrigin } from './net.mjs'
import { paneRefusal } from './request-guard.mjs'

const BRIDGE_ROUTE = '/__qa/bridge.js'
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1']

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

// `headers` adds to the 421, e.g. the pane's frame policy.
export function misdirected(res, headers = {}) {
  res.writeHead(421, { 'content-type': 'text/plain', ...headers })
  res.end('421: unrecognised Host header')
}

// An http(s) origin, normalized, or null for anything else. `new URL()` alone
// would turn a file: or data: URL into the string 'null'.
function originOrNull(value) {
  try { return webOrigin(value) } catch { return null }
}

// The pane's frame policy: the pane itself, the harness origin, then any
// extra ancestors (a harness that is itself framed). Values that aren't
// http(s) origins are dropped, and so are IPv6 literals, which a CSP source
// can't carry. The proxy and the conductor's pane servers share it.
export function panePolicy(harnessOrigin = null, frameAncestors = []) {
  const sources = new Set()
  for (const value of [harnessOrigin, ...[].concat(frameAncestors ?? [])]) {
    const origin = originOrNull(value)
    if (origin && !new URL(origin).hostname.startsWith('[')) sources.add(origin)
  }
  return ["frame-ancestors 'self'", ...sources].join(' ')
}

const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function bridgeTag(harnessOrigin) {
  const data = harnessOrigin ? ` data-harness="${escapeAttr(harnessOrigin)}"` : ''
  return `<script src="${BRIDGE_ROUTE}"${data}></script>`
}

// The upstream's own policies minus any frame-ancestors directive, plus ours.
// Several policies in one header are comma-separated, and a browser enforces
// each of them.
function withFrameAncestors(upstreamCsp, frameAncestors) {
  const upstream = Array.isArray(upstreamCsp) ? upstreamCsp.join(', ') : upstreamCsp ?? ''
  const kept = upstream
    .split(',')
    .map(policy => policy.split(';').map(d => d.trim()).filter(d => d && !/^frame-ancestors(\s|$)/i.test(d)).join('; '))
    .filter(Boolean)
  return [...kept, frameAncestors].join(', ')
}

// Parse one Set-Cookie header into { name, value, remove }. A cookie is a
// removal when Max-Age <= 0, Expires is in the past (Max-Age wins when both
// are present, per RFC 6265), or the value is empty / the conventional
// 'deleted' sentinel.
export function parseSetCookie(header) {
  const [pair, ...attrs] = String(header).split(';')
  const eq = pair.indexOf('=')
  const name = (eq === -1 ? pair : pair.slice(0, eq)).trim()
  const value = eq === -1 ? '' : pair.slice(eq + 1).trim()
  let maxAge = null
  let expires = null
  for (const attr of attrs) {
    const i = attr.indexOf('=')
    const key = (i === -1 ? attr : attr.slice(0, i)).trim().toLowerCase()
    const v = i === -1 ? '' : attr.slice(i + 1).trim()
    if (key === 'max-age') maxAge = Number(v)
    else if (key === 'expires') expires = Date.parse(v)
  }
  let remove = value === '' || value === 'deleted'
  if (maxAge !== null && !Number.isNaN(maxAge)) {
    if (maxAge <= 0) remove = true
  } else if (expires !== null && !Number.isNaN(expires) && expires <= Date.now()) {
    remove = true
  }
  return { name, value, remove }
}

// The client's own Cookie header is kept; the jar wins on a name both have.
function mergeCookieHeader(clientCookie, jar) {
  const merged = new Map()
  if (clientCookie) {
    for (const part of String(clientCookie).split(';')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      merged.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
    }
  }
  for (const [name, value] of jar) merged.set(name, value)
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

function responseHeaders(upRes, upstreamPort, policy) {
  const headers = {}
  for (const [key, value] of Object.entries(upRes.headers)) {
    const k = key.toLowerCase()
    if (k === 'set-cookie' || k === 'transfer-encoding' || k === 'connection' || k === 'keep-alive') {
      continue
    }
    // X-Frame-Options would stop the harness framing the pane; our
    // frame-ancestors (below) decides who may.
    if (k === 'x-frame-options') continue
    headers[k] = value
  }
  headers['content-security-policy'] = withFrameAncestors(headers['content-security-policy'], policy)
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

function injectBridge(body, tag) {
  const html = body.toString('utf8')
  const match = /<\/head>/i.exec(html)
  const injected = match
    ? html.slice(0, match.index) + tag + html.slice(match.index)
    : tag + html
  return Buffer.from(injected, 'utf8')
}

function serveBridge(bridgePath, res, policy) {
  readFile(bridgePath).then(
    (content) => {
      res.writeHead(200, { 'content-type': 'text/javascript', 'content-length': content.length, 'content-security-policy': policy })
      res.end(content)
    },
    () => {
      res.writeHead(404, { 'content-type': 'text/plain', 'content-security-policy': policy })
      res.end('bridge script not found')
    },
  )
}

// harnessOrigin: the origin the harness page is served at (e.g.
// https://host:8444). Only it, the pane itself and frameAncestors may frame
// the pane, only its Referer admits a navigation from another site, and the
// bridge talks only to it. Without one, nothing else may frame the pane and
// the mirror is off. Both may be values or functions resolved per request
// (the conductor derives a port-0 harness's origin once it listens); anything
// that isn't an http(s) origin is dropped.
export function createPaneProxy({
  upstreamPort, bridgePath, onActivity = () => {}, httpMod = http, allowedHosts = [], harnessOrigin = null, frameAncestors = [],
}) {
  // name -> value
  const jar = new Map()
  // A number, or a function resolved per request: the conductor points the
  // pane at whatever port the Provisioner reserved for the running session.
  const portOf = typeof upstreamPort === 'function' ? upstreamPort : () => upstreamPort
  // Likewise: the conductor's pane origins may be assigned after start.
  const hostsOf = typeof allowedHosts === 'function' ? allowedHosts : () => allowedHosts
  const harnessOf = typeof harnessOrigin === 'function' ? harnessOrigin : () => harnessOrigin
  const ancestorsOf = typeof frameAncestors === 'function' ? frameAncestors : () => frameAncestors

  return function handler(req, res) {
    const harness = originOrNull(harnessOf())
    const policy = panePolicy(harness, ancestorsOf())
    if (!isAllowedHost(req.headers.host, hostsOf())) return misdirected(res, { 'content-security-policy': policy })

    const refusal = paneRefusal(req, harness)
    if (refusal) {
      res.writeHead(403, {
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'content-security-policy': policy,
      })
      res.end(`403: ${refusal}\n`)
      return
    }

    const pathname = (req.url ?? '/').split('?')[0]
    if (req.method === 'GET' && pathname === BRIDGE_ROUTE) {
      serveBridge(bridgePath, res, policy)
      return
    }

    onActivity()

    const port = portOf()
    if (!port) {
      res.writeHead(503, { 'content-type': 'text/plain', 'content-security-policy': policy })
      res.end('503: no QA session is running on this pane')
      return
    }

    const upReq = httpMod.request(
      {
        host: '127.0.0.1',
        port,
        method: req.method,
        path: req.url,
        headers: upstreamHeaders(req, jar),
      },
      (upRes) => {
        const rawSetCookies = upRes.headers['set-cookie'] ?? []
        for (const raw of Array.isArray(rawSetCookies) ? rawSetCookies : [rawSetCookies]) {
          const { name, value, remove } = parseSetCookie(raw)
          if (!name) continue
          if (remove) jar.delete(name)
          else jar.set(name, value)
        }

        const headers = responseHeaders(upRes, port, policy)
        const isHtml = /^text\/html\b/i.test(upRes.headers['content-type'] ?? '')
        if (!isHtml) {
          res.writeHead(upRes.statusCode ?? 502, headers)
          upRes.pipe(res)
          return
        }

        const chunks = []
        upRes.on('data', (chunk) => chunks.push(chunk))
        upRes.on('end', () => {
          const body = injectBridge(Buffer.concat(chunks), bridgeTag(harness))
          headers['content-length'] = body.length
          res.writeHead(upRes.statusCode ?? 502, headers)
          res.end(body)
        })
      },
    )

    upReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain', 'content-security-policy': policy })
      res.end('502: QA pane upstream unavailable')
    })

    req.pipe(upReq)
  }
}
