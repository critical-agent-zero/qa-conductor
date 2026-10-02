// Which page made a request (homefree #307, ported from its #329). The Host
// allowlist stops DNS rebinding, but not a page the reviewer has open in the
// same browser: that page can make the browser send requests to the harness
// and the panes, and a front door that authenticates the device (tailscale
// serve) vouches for those too. These checks keep such pages out of the
// harness API and the panes.
//
// `same-site` is never enough: on loopback every port is same-site, and
// ts.net is on the Public Suffix List, so every host in a tailnet, and every
// port of this one, is same-site as well.

import { isLoopbackHost } from './net.mjs'

// A Host header's characters: a hostname, an IPv6 literal and a port. Anything
// else (`@`, `/`) would let the URL parser read a different host from it.
const HOST_HEADER = /^[a-z0-9.\-[\]:]+$/

// True when a browser request comes from the target's own origin, or from
// no page at all. Browsers send Sec-Fetch-Site (on trustworthy origins) or at
// least Origin on every write; a request with neither is a non-browser client
// (curl, a platform's own script).
export function isSameOriginRequest(headers) {
  const site = headers['sec-fetch-site']
  if (site !== undefined) return site === 'same-origin' || site === 'none'
  if (headers.origin !== undefined) {
    try { return new URL(headers.origin).host === headers.host } catch { return false }
  }
  return true
}

// True unless a browser reached the harness at a host or port other than the
// harness origin's. A page served by another handler that proxies to the
// harness (a stale `tailscale serve` mount on another port, say) is
// same-origin with that handler, so isSameOriginRequest admits its calls;
// this check doesn't. Exempt:
// - non-browser clients (neither Sec-Fetch-Site nor Origin);
// - a null harness origin, which the conductor reports at startup;
// - a loopback Host: the harness opened at localhost (to show its banner), a
//   harness on port 0 that derives its origin per request, and a nested demo,
//   whose outer pane proxy forwards with a loopback Host.
export function isHarnessHost(headers, harnessOrigin) {
  if (headers['sec-fetch-site'] === undefined && headers.origin === undefined) return true
  if (harnessOrigin == null) return true
  const host = String(headers.host ?? '').trim().toLowerCase()
  if (!HOST_HEADER.test(host)) return false
  let harness, request
  try {
    harness = new URL(harnessOrigin)
    // Parsed with the harness's scheme, so its default port drops out too.
    request = new URL(`${harness.protocol}//${host}`)
  } catch {
    return false
  }
  return isLoopbackHost(request.hostname) || request.host === harness.host
}

const FRAME_DESTS = new Set(['iframe', 'frame', 'embed', 'object', 'fencedframe'])
const OTHER_SITES = new Set(['same-site', 'cross-site'])
const NAVIGATE_MODES = new Set(['navigate', 'nested-navigate'])

// The origin a Referer names, or null.
function refererOrigin(headers) {
  try { return new URL(headers.referer).origin } catch { return null }
}

// Why a pane proxy must refuse this request, or null to serve it. The proxy
// adds the operator's session from its own cookie jar, so the app's SameSite
// cookies protect nothing behind it, and the app acts as the operator on
// every request that reaches it, whether or not the page that made it can
// read the answer:
// - writes and preflights must come from the pane's own pages;
// - so must CORS reads and WebSockets (an app that echoes Origin back would
//   otherwise hand the operator's data to the page that asked);
// - so must subresource loads (<img>, <script>, <link>, a no-cors fetch):
//   Sec-Fetch-Site same-site or cross-site is refused;
// - a navigation from another site, into a frame or top-level, must come
//   from the harness, which loads the panes in its iframes and opens them in
//   new tabs: its Referer must be harnessOrigin (browsers send the referring
//   origin by default). frame-ancestors, set on every response, stops only
//   the render, after the app has handled the request.
// A navigation the operator starts (Sec-Fetch-Site none) is served. A
// request with no Sec-Fetch-Site (curl, or a browser too old to send it) is
// judged by its Origin alone.
export function paneRefusal(req, harnessOrigin = null) {
  const headers = req.headers
  const site = headers['sec-fetch-site']
  const mode = headers['sec-fetch-mode']
  const read = req.method === 'GET' || req.method === 'HEAD'
  const fromPage = !read || mode === 'cors' || mode === 'websocket' || headers.origin !== undefined
  if (fromPage && !isSameOriginRequest(headers)) return 'cross-site request refused'
  if (!OTHER_SITES.has(site)) return null
  if (!NAVIGATE_MODES.has(mode)) return 'cross-site request refused'
  if (harnessOrigin !== null && refererOrigin(headers) === harnessOrigin) return null
  return FRAME_DESTS.has(headers['sec-fetch-dest']) ? 'cross-site framing refused' : 'cross-site navigation refused'
}
