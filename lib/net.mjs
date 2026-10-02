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
