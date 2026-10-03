// Address and origin helpers shared by the config loader, the servers and the
// request guards. Pure: no I/O.

import { isIPv4 } from 'node:net'

// A hostname a CSP source and a Host allowlist can both carry: DNS labels
// (letters, digits, `-`) or a bracketed IPv6 literal. The URL parser accepts
// more (`;`, `,`, `'`, `*`), and those would change a policy's meaning.
const SAFE_HOSTNAME = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?|\[[0-9a-f:.]+\])$/

// host:port, with brackets around an IPv6 literal.
export const hostPort = (host, port) => (host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`)

// True for 127.0.0.0/8, ::1 and localhost. `[]` is stripped, since
// URL.hostname keeps it on an IPv6 literal.
export function isLoopbackHost(name) {
  const h = String(name ?? '').toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return h === '::1' || h === 'localhost' || (isIPv4(h) && h.startsWith('127.'))
}

// A web origin, normalized: scheme and host lowercased, a default port, any
// path and a trailing slash dropped. Anything that isn't an http(s) URL with
// a plain hostname throws, naming `what` (a config key or a cfg field).
// `new URL('file:///x').origin` and a data: URL's are the string 'null'.
export function webOrigin(value, what = 'an origin') {
  let url
  try { url = new URL(value) } catch { url = null }
  if ((url?.protocol !== 'https:' && url?.protocol !== 'http:') || !SAFE_HOSTNAME.test(url.hostname)) {
    const shown = typeof value === 'string' ? JSON.stringify(value) : String(value)
    throw new Error(`${what} must be an origin such as https://host:8444, got ${shown}`)
  }
  return url.origin
}

// The port an http(s) origin is served on: its own, else the scheme's default
// (443 for https, 80 for http), which URL.port leaves empty.
export function portOf(origin) {
  const url = new URL(origin)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`portOf needs an http(s) origin, got ${JSON.stringify(String(origin))}`)
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80))
}

// Throws unless browsers send Fetch Metadata (Sec-Fetch-*) to `origin`, a
// webOrigin() result. They send it only to potentially trustworthy origins:
// https, and http on a loopback host. Without it, and with no Origin on a
// GET, another page's <img>, <iframe> or link looks like a non-browser
// client, so `guard` (the request guard that depends on it) would admit it.
// The message names `what` (a config key or a cfg field).
export function requireFetchMetadata(origin, what, guard) {
  const url = new URL(origin)
  if (url.protocol === 'https:' || isLoopbackHost(url.hostname)) return
  throw new Error(
    `${what} ${origin}: browsers send no Sec-Fetch-* headers to a plain-http origin off loopback, ` +
      `so the ${guard} can't tell other pages apart; use https or a loopback address`,
  )
}
