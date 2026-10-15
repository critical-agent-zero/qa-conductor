// Pane proxy for QA sessions. Fronts one pane's app container:
//
// - Holds the pane's cookies in a server-side jar. Cookies ignore ports, so
//   two app versions behind one tailnet hostname would collide in the
//   browser; pane Set-Cookie headers are absorbed here and never forwarded.
// - For the same reason, sends the app only the jar's cookies, not the
//   browser's: those are every cookie for the hostname, another app's on
//   another port and any the other pane's scripts set included, and the app
//   runs PR code. forwardClientCookies names any to pass through, and only
//   values with no room to hide another cookie in pass.
// - Injects the mirror bridge <script> into text/html responses and serves
//   the bridge file at /__qa/bridge.js (read per request, no cache). The tag
//   carries the harness origin (data-harness), the only origin the bridge
//   talks to.
// - Stamps activity (onActivity) for the idle reaper.
// - Drops tailscale serve's `Tailscale-*` identity headers before the app,
//   which runs PR code, sees the request.
// - Rewrites absolute http://127.0.0.1:<upstreamPort> Locations to relative
//   so redirects stay on the pane's public origin, and drops the
//   Referrer-Policy of a redirect that stays on the pane, so the harness's
//   Referer still admits the next hop.
// - Answers 421 to any request whose Host isn't loopback or an allowed
//   hostname, before routing: a DNS-rebound page must not drive a signed-in
//   pane. The harness server reuses the same check.
// - Since the jar signs every request in as the operator, refuses requests
//   other pages make, and navigations from another site that the harness did
//   not start (lib/request-guard.mjs).
// - Decides who may frame the pane: every response it sends carries
//   `frame-ancestors 'self' <harness origin> <frameAncestors…>` in place of
//   the app's own frame-ancestors directive and X-Frame-Options.
// - Given the conductor's capability, serves only a browser holding the pane
//   cookie, which /__qa/enter sets from a one-time ticket (lib/capability.mjs).

import http from 'node:http'
import { readFile } from 'node:fs/promises'

import { sanitizeMethod, sanitizePath } from './action-log.mjs'
import { ENTER_ROUTE, REFUSAL_CAPABILITY, cookieValues, paneCookie } from './capability.mjs'
import { cookieNames, webOrigin } from './net.mjs'
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

// A cookie-value as RFC 6265 defines it: visible ASCII except space, `"`,
// `,`, `;` and `\`, optionally inside one pair of double quotes. A browser
// keeps whatever a page writes with document.cookie, commas and spaces
// included, and sends it back as is, so `locale=fr, sid=evil` would hide a
// second cookie in a passed one, which a lenient parser (comma- or
// space-splitting) reads as a cookie of its own.
const COOKIE_VALUE = /^(?:[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*|"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*")$/

// The Cookie header the app gets: the jar's cookies, then the browser's whose
// names are in `passed` (a Set) and whose values are cookie-values, as the
// browser sent them; any other is dropped. A name the jar has is never passed,
// and the jar's come first, for a parser that keeps the first of a name. ''
// when there is nothing to send.
function upstreamCookie(clientCookie, passed, jar) {
  const pairs = [...jar].map(([name, value]) => `${name}=${value}`)
  if (clientCookie && passed.size > 0) {
    for (const part of String(clientCookie).split(';')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      const name = part.slice(0, eq).trim()
      const value = part.slice(eq + 1).trim()
      if (passed.has(name) && !jar.has(name) && COOKIE_VALUE.test(value)) pairs.push(`${name}=${value}`)
    }
  }
  return pairs.join('; ')
}

// tailscale serve's identity headers (the reviewer's login, name, picture)
// are for the conductor's gate, and the browser's cookies are the hostname's;
// the pane app runs PR code.
function upstreamHeaders(req, jar, passed) {
  const headers = {}
  for (const [key, value] of Object.entries(req.headers)) {
    const k = key.toLowerCase()
    if (k === 'host' || k === 'accept-encoding' || k === 'cookie') continue
    if (k === 'connection' || k === 'keep-alive' || k === 'proxy-connection') continue
    if (k.startsWith('tailscale-')) continue
    headers[k] = value
  }
  headers['accept-encoding'] = 'identity'
  const cookie = upstreamCookie(req.headers.cookie, passed, jar)
  if (cookie) headers.cookie = cookie
  return headers
}

// A Host header's characters, as in lib/request-guard.mjs: anything else
// (`@`, `/`) would let the URL parser read a different host from it.
const HOST_HEADER = /^[a-z0-9.\-[\]:]+$/

// True when a Location leads back to the pane that answered: a relative
// reference, or an absolute URL whose host is the request's Host. The URL
// parser decides, so `//x` and `/\x` count as other hosts, as in a browser.
function staysOnPane(location, hostHeader) {
  const host = String(hostHeader ?? '').trim().toLowerCase()
  if (typeof location !== 'string' || !HOST_HEADER.test(host)) return false
  try {
    const pane = new URL(`http://${host}/`)
    return new URL(location, pane).host === pane.host
  } catch {
    return false
  }
}

// A Clear-Site-Data value without its "cookies" type, "*" standing for the
// types that remain; '' when nothing is left.
function clearSiteDataWithoutCookies(value) {
  const types = [].concat(value).join(',').split(',').map(type => type.trim()).filter(Boolean)
  const kept = types.flatMap(type => {
    const name = type.replace(/^"(.*)"$/, '$1').toLowerCase()
    if (name === 'cookies') return []
    return name === '*' ? ['"cache"', '"storage"', '"executionContexts"'] : [type]
  })
  return [...new Set(kept)].join(', ')
}

function responseHeaders(upRes, upstreamPort, policy, requestHost) {
  const headers = {}
  for (const [key, value] of Object.entries(upRes.headers)) {
    const k = key.toLowerCase()
    if (k === 'set-cookie' || k === 'transfer-encoding' || k === 'connection' || k === 'keep-alive') {
      continue
    }
    // X-Frame-Options would stop the harness framing the pane; our
    // frame-ancestors (below) decides who may.
    if (k === 'x-frame-options') continue
    // The identity gate's marker is the conductor's alone: from the pane app
    // (PR code) it could make an ungated pane look gated to the expose CLI.
    if (k === 'x-qa-refusal') continue
    // From the pane app, its cookie types would wipe the browser's cookies
    // for the whole hostname, the pane cookie among them: the rest pass.
    if (k === 'clear-site-data') {
      const kept = clearSiteDataWithoutCookies(value)
      if (kept) headers[k] = kept
      continue
    }
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
  // A redirect's own Referrer-Policy sets the Referer of the request it leads
  // to. When the harness started the navigation (its iframe load, a reload,
  // a resync, "Open in new tab"), that Referer is what admits the next hop
  // (lib/request-guard.mjs), so an app's no-referrer or same-origin would get
  // its own redirect refused. Without the header, the next hop keeps the
  // policy of the page that started the navigation. Only for a redirect that
  // stays on the pane: elsewhere the app's policy still holds.
  const status = upRes.statusCode ?? 0
  if (status >= 300 && status < 400 && staysOnPane(headers.location, requestHost)) delete headers['referrer-policy']
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
//
// forwardClientCookies: the browser's own cookies the app gets, beside the
// jar's. false (the default) sends none; an array of cookie names sends
// those whose values are RFC 6265 cookie-values, and the jar's value wins on
// a name both have. Anything else, true and a wildcard included, throws: on a
// shared hostname, any page there can set a cookie, the other pane's scripts
// included.
//
// The handler's clearJar() gives the proxy a fresh jar; otherwise one lasts as
// long as the proxy. The conductor calls it when a session ends, when the next
// boots and when it is ready, so no app gets the cookies an earlier session's
// app set. Each request keeps the jar it started with, so a late response from
// the old app fills the old jar, never the new one.
//
// capability: null (the default) serves every request the guards admit. The
// conductor passes { cookieName(), admits(value), enter(ticket) } (see
// lib/capability.mjs): then a request is served only when a cookie of that
// name holds a value admits() takes, and GET /__qa/enter?t=<ticket> answers
// 303 to enter()'s { to } with that cookie set to its { value } (Secure under
// a __Host- name). The app never gets the cookie (it is never forwarded) nor
// the /__qa/enter request, so nor the ticket in its URL; a refusal is a 403
// marked X-QA-Refusal: capability. The Host check and the request guard run
// first.
//
// recorder: () => record | null, the session's action log (#8). It is asked
// at the start of each request the proxy forwards, as the jar is bound, and
// the record it gives is handed { at, method, path, status, ms, bytes,
// aborted } once the response ends: the path sanitized (lib/action-log.mjs),
// never a header, cookie, body or query value. onRefused(reason) is told of
// each request the Host check or a guard refuses, by a fixed reason
// ('misdirected', the request guard's, 'capability'), and nothing more of
// it. The bridge, the pane entry and a pane with no session are neither.
export function createPaneProxy({
  upstreamPort, bridgePath, onActivity = () => {}, httpMod = http, allowedHosts = [], harnessOrigin = null, frameAncestors = [],
  forwardClientCookies = false, capability = null, recorder = () => null, onRefused = () => {},
}) {
  const passed = new Set(cookieNames(forwardClientCookies, 'forwardClientCookies'))
  // name -> value; replaced, never emptied, by clearJar()
  let jar = new Map()
  // A number, or a function resolved per request: the conductor points the
  // pane at whatever port the Provisioner reserved for the running session.
  const portOf = typeof upstreamPort === 'function' ? upstreamPort : () => upstreamPort
  // Likewise: the conductor's pane origins may be assigned after start.
  const hostsOf = typeof allowedHosts === 'function' ? allowedHosts : () => allowedHosts
  const harnessOf = typeof harnessOrigin === 'function' ? harnessOrigin : () => harnessOrigin
  const ancestorsOf = typeof frameAncestors === 'function' ? frameAncestors : () => frameAncestors

  function handler(req, res) {
    const harness = originOrNull(harnessOf())
    const policy = panePolicy(harness, ancestorsOf())
    if (!isAllowedHost(req.headers.host, hostsOf())) {
      onRefused('misdirected')
      return misdirected(res, { 'content-security-policy': policy })
    }

    const refusal = paneRefusal(req, harness)
    if (refusal) {
      onRefused(refusal)
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
    if (capability !== null) {
      const name = capability.cookieName()
      if (pathname === ENTER_ROUTE) return enter(req, res, name, policy)
      if (!cookieValues(req.headers.cookie, name).some(value => capability.admits(value))) {
        onRefused('capability')
        return refuseCapability(res, policy, 'this browser has no capability for this pane: open the pane from the harness')
      }
    }

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

    // The session this request belongs to: its response fills this jar even if
    // clearJar() has given the proxy a new one by the time it arrives, and
    // its entry goes to this session's log.
    const sessionJar = jar
    const record = recorder()
    const at = Date.now()
    let bytes = 0
    if (typeof record === 'function') {
      res.once('close', () => record({
        at,
        method: sanitizeMethod(req.method),
        path: sanitizePath(req.url),
        status: res.headersSent ? res.statusCode : 0,
        ms: Date.now() - at,
        bytes,
        aborted: !res.writableFinished,
      }))
    }
    const upReq = httpMod.request(
      {
        host: '127.0.0.1',
        port,
        method: req.method,
        path: req.url,
        headers: upstreamHeaders(req, sessionJar, passed),
      },
      (upRes) => {
        const rawSetCookies = upRes.headers['set-cookie'] ?? []
        for (const raw of Array.isArray(rawSetCookies) ? rawSetCookies : [rawSetCookies]) {
          const { name, value, remove } = parseSetCookie(raw)
          if (!name) continue
          if (remove) sessionJar.delete(name)
          else sessionJar.set(name, value)
        }

        const headers = responseHeaders(upRes, port, policy, req.headers.host)
        const isHtml = /^text\/html\b/i.test(upRes.headers['content-type'] ?? '')
        if (!isHtml) {
          res.writeHead(upRes.statusCode ?? 502, headers)
          upRes.on('data', (chunk) => { bytes += chunk.length })
          upRes.pipe(res)
          return
        }

        const chunks = []
        upRes.on('data', (chunk) => chunks.push(chunk))
        upRes.on('end', () => {
          const body = injectBridge(Buffer.concat(chunks), bridgeTag(harness))
          bytes = body.length
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

  // The harness's iframe, or new tab, redeeming a pane-entry ticket. The
  // redirect sets no Referrer-Policy, and must not. A browser computes the
  // next hop's Sec-Fetch-Site over the whole redirect chain from the
  // harness, so it is same-site, and only the harness's Referer gets it past
  // the request guard: under no-referrer, Chromium's landing hop is refused
  // ("cross-site framing refused"). That Referer is the harness page's, as
  // the request's referrer stays across redirects, never this /__qa/enter
  // URL, so neither it nor the app's document.referrer carries the ticket,
  // which is spent by then anyway.
  function enter(req, res, name, policy) {
    const ticket = req.method === 'GET' ? new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('t') : null
    const out = ticket ? capability.enter(ticket) : null
    if (!out) {
      onRefused('capability')
      return refuseCapability(res, policy, 'this pane entry link has expired or was already used: reload the pane from the harness')
    }
    res.writeHead(303, {
      location: out.to,
      'set-cookie': [paneCookie(name, out.value, name.startsWith('__Host-'))],
      'cache-control': 'no-store',
      'content-security-policy': policy,
    })
    res.end()
  }

  handler.clearJar = () => { jar = new Map() }
  return handler
}

function refuseCapability(res, policy, message) {
  res.writeHead(403, {
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'content-security-policy': policy,
    'x-qa-refusal': REFUSAL_CAPABILITY,
  })
  res.end(`403: ${message}\n`)
}
