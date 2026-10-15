// The PR pane's forwarder (#32): the one way into, and out of, a PR pane on
// an internal network, where its containers have no route off their network.
// The Docker Provisioner runs this file, as it is, in a container that joins
// both the PR pane's internal network and an ordinary one:
// `node --input-type=module -e <this file>`, with its config as JSON in
// PANE_FORWARDER. So it imports nothing but Node's own modules.
//
// - Inbound: it listens on `forward.listen` and pipes each connection to
//   `forward.to` (the PR app), which the Provisioner publishes on the host's
//   loopback in the app's place.
// - Egress: an HTTP proxy on `proxy.listen`. HTTPS goes through CONNECT and
//   is never intercepted; plain HTTP is forwarded. A request goes out only
//   to a host on the allowlist, every address of which is public, and to the
//   address that was checked, so a second DNS answer can't swap it.
//   Loopback, private, link-local (cloud metadata), CGNAT (Tailscale),
//   unique-local, multicast and the like are always refused, listed or not:
//   among them every address a container runtime gives the host. The list is
//   empty by default: no egress at all.
//
// Exported for tests: the allowlist, the address check and createForwarder.

import net from 'node:net'
import http from 'node:http'
import dns from 'node:dns/promises'

// Without a port, an allowlist entry admits these.
const DEFAULT_PORTS = [80, 443]
// How long a connection out may take to open, and a tunnel may sit idle.
const CONNECT_MS = 10_000
const IDLE_MS = 5 * 60_000

// --- Addresses -------------------------------------------------------------------

const V4 = [
  ['0.0.0.0', 8, 'unspecified'], ['10.0.0.0', 8, 'private'], ['100.64.0.0', 10, 'shared (CGNAT, Tailscale)'],
  ['127.0.0.0', 8, 'loopback'], ['169.254.0.0', 16, 'link-local (cloud metadata)'], ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'special-purpose'], ['192.0.2.0', 24, 'documentation'], ['192.88.99.0', 24, 'special-purpose'],
  ['192.168.0.0', 16, 'private'], ['198.18.0.0', 15, 'benchmarking'], ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'], ['224.0.0.0', 4, 'multicast'], ['240.0.0.0', 4, 'reserved'],
]
const V6 = [
  ['::', 96, 'unspecified, loopback or IPv4-compatible'], ['64:ff9b::', 96, 'NAT64'], ['64:ff9b:1::', 48, 'NAT64'],
  ['100::', 64, 'discard'], ['2001::', 23, 'special-purpose'], ['2001:db8::', 32, 'documentation'], ['2002::', 16, '6to4'],
  ['3fff::', 20, 'documentation'],
  ['fc00::', 7, 'unique local'], ['fe80::', 10, 'link-local'], ['fec0::', 10, 'site-local'], ['ff00::', 8, 'multicast'],
]
const ranges = (list, type) => list.map(([address, prefix, kind]) => {
  const block = new net.BlockList()
  block.addSubnet(address, prefix, type)
  return [block, kind]
})
const BLOCKED_V4 = ranges(V4, 'ipv4')
const BLOCKED_V6 = ranges(V6, 'ipv6')
const GLOBAL_V6 = ranges([['2000::', 3, 'global']], 'ipv6')[0][0]

// An IPv6 address as its eight 16-bit groups, or null.
function groups6(ip) {
  let text = ip
  // a dotted IPv4 tail as two groups
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted) {
    if (!net.isIPv4(dotted[2])) return null
    const b = dotted[2].split('.').map(Number)
    text = `${dotted[1]}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const part = s => (s === '' ? [] : s.split(':').map(h => (/^[0-9a-f]{1,4}$/i.test(h) ? Number.parseInt(h, 16) : NaN)))
  const head = part(halves[0])
  const rest = halves.length === 2 ? part(halves[1]) : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const all = [...head, ...Array(missing).fill(0), ...rest]
  return all.every(g => Number.isInteger(g)) ? all : null
}

// Why an address must not be connected to, or null for a public one. Only
// a global unicast IPv6 address (2000::/3) can be public; an IPv4-mapped one
// is judged as its IPv4 address.
export function blockedAddress(address) {
  const ip = String(address ?? '').replace(/^\[|\]$/g, '').split('%')[0]
  if (net.isIPv4(ip)) return BLOCKED_V4.find(([block]) => block.check(ip, 'ipv4'))?.[1] ?? null
  if (!net.isIPv6(ip)) return 'not an IP address'
  const g = groups6(ip)
  if (g === null) return 'not an IP address'
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) {
    return blockedAddress(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`)
  }
  const found = BLOCKED_V6.find(([block]) => block.check(ip, 'ipv6'))
  if (found) return found[1]
  return GLOBAL_V6.check(ip, 'ipv6') ? null : 'not global unicast'
}

// --- The allowlist ---------------------------------------------------------------

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const isHostname = h => h.length <= 253 && h.split('.').length >= 2 && h.split('.').every(l => LABEL.test(l)) && !/^\d+$/.test(h.split('.').at(-1))

// A host as compared: lowercase, no trailing dot, no IPv6 brackets.
const normalHost = host => String(host ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1')

// `host:port` (a CONNECT target, or an entry) split, IPv6 in brackets; port
// null when there is none.
function splitHostPort(text) {
  const s = String(text ?? '').trim()
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(s)
  if (bracket) return { host: bracket[1], port: bracket[2] === undefined ? null : Number(bracket[2]) }
  const colon = s.lastIndexOf(':')
  if (colon !== -1 && s.indexOf(':') === colon) return { host: s.slice(0, colon), port: /^\d+$/.test(s.slice(colon + 1)) ? Number(s.slice(colon + 1)) : NaN }
  return { host: s, port: null }
}
const isPort = p => Number.isInteger(p) && p >= 1 && p <= 65535

// The allowlist's entries, checked: `api.example.com` (that host only),
// `*.example.com` (any host under it, not itself), or a public IP address,
// each with an optional `:port`. Without a port, 80 and 443. Anything else
// throws, so a typo never opens more than meant.
export function parseAllowlist(entries) {
  if (entries === undefined || entries === null) return []
  if (!Array.isArray(entries)) throw new Error('the egress allowlist must be an array of hosts')
  return entries.map((entry, i) => {
    if (typeof entry !== 'string') throw new Error(`egress[${i}] must be a string`)
    const { host: raw, port } = splitHostPort(entry)
    if (port !== null && !isPort(port)) throw new Error(`egress[${i}] has a bad port: ${JSON.stringify(entry)}`)
    const host = normalHost(raw)
    const wildcard = host.startsWith('*.')
    const name = wildcard ? host.slice(2) : host
    if (net.isIP(name)) {
      if (wildcard) throw new Error(`egress[${i}]: an IP address takes no wildcard: ${JSON.stringify(entry)}`)
      const blocked = blockedAddress(name)
      if (blocked) throw new Error(`egress[${i}]: ${name} is ${blocked}, which is always refused`)
    } else if (!isHostname(name) || (wildcard && name.split('.').length < 2)) {
      throw new Error(`egress[${i}] must be a host name, *.domain or a public IP address, with an optional :port: ${JSON.stringify(entry)}`)
    }
    return { host: name, wildcard, ports: port === null ? DEFAULT_PORTS : [port] }
  })
}

const listed = (rules, host, port) => rules.some(r => r.ports.includes(port) && (r.wildcard ? host.endsWith(`.${r.host}`) : host === r.host))

// Whether a request may go to host:port, and to which address: { address }
// or { refused: reason }. `lookup(host)` resolves to every address of host.
export async function checkTarget(rules, host, port, lookup) {
  const name = normalHost(host)
  if (!isPort(port)) return { refused: 'no valid port' }
  if (net.isIP(name)) {
    const blocked = blockedAddress(name)
    if (blocked) return { refused: `${name} is ${blocked}` }
    return listed(rules, name, port) ? { address: name } : { refused: `${name}:${port} is not on the allowlist` }
  }
  if (!isHostname(name)) return { refused: 'not a host name' }
  if (!listed(rules, name, port)) return { refused: `${name}:${port} is not on the allowlist` }
  let addresses
  try {
    addresses = (await lookup(name)).map(a => (typeof a === 'string' ? a : a.address))
  } catch (err) {
    return { refused: `${name} does not resolve (${err?.code ?? 'error'})` }
  }
  if (addresses.length === 0) return { refused: `${name} does not resolve` }
  for (const address of addresses) {
    const blocked = blockedAddress(address)
    if (blocked) return { refused: `${name} resolves to ${address}, which is ${blocked}` }
  }
  return { address: addresses[0] }
}

// --- The servers -----------------------------------------------------------------

const HOP_BY_HOP = new Set(['connection', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'keep-alive', 'te', 'trailer', 'upgrade'])

function refuse(socket, status, reason) {
  const text = `${reason}\n`
  socket.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : status === 400 ? 'Bad Request' : 'Bad Gateway'}\r\nX-QA-Egress: refused\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`)
}

const defaultLookup = host => dns.lookup(host, { all: true, verbatim: true })
const defaultConnect = (port, address) => net.connect({ port, host: address })

// config: { forward?: { listen, to: 'host:port' }, proxy?: { listen, allow } }.
// lookup and connect are for tests. Resolves once every server listens.
export async function createForwarder({ forward = null, proxy = null, host = '0.0.0.0', lookup = defaultLookup, connect = defaultConnect, log = line => console.error(line) } = {}) {
  const servers = []
  const opened = (server, port) => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.off('error', reject); resolve() })
  })

  if (forward) {
    const to = splitHostPort(forward.to)
    if (!to.host || !isPort(to.port) || !isPort(forward.listen)) throw new Error('forward needs listen (a port) and to (host:port)')
    const server = net.createServer(client => {
      const upstream = net.connect({ host: to.host, port: to.port })
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
      client.pipe(upstream).pipe(client)
    })
    await opened(server, forward.listen)
    servers.push(server)
  }

  if (proxy) {
    const rules = parseAllowlist(proxy.allow)
    if (!isPort(proxy.listen)) throw new Error('proxy needs listen (a port)')
    const decide = async (hostName, port) => {
      const out = await checkTarget(rules, hostName, port, lookup)
      if (out.refused) log(`qa-egress refused ${normalHost(hostName)}:${port}: ${out.refused}`)
      return out
    }
    const server = http.createServer(async (req, res) => {
      // only proxy requests, and only plain http: HTTPS goes through CONNECT
      let target
      try { target = new URL(req.url) } catch { target = null }
      if (!target || target.protocol !== 'http:') {
        res.writeHead(400, { 'x-qa-egress': 'refused', 'content-type': 'text/plain' })
        return res.end('only absolute http:// requests; HTTPS goes through CONNECT\n')
      }
      const port = target.port ? Number(target.port) : 80
      const out = await decide(target.hostname, port)
      if (out.refused) {
        res.writeHead(403, { 'x-qa-egress': 'refused', 'content-type': 'text/plain' })
        return res.end(`${out.refused}\n`)
      }
      const headers = {}
      for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v
      headers.host = target.host
      const upstream = http.request({
        method: req.method, path: `${target.pathname}${target.search}`, headers, setHost: false,
        createConnection: () => connect(port, out.address),
      }, upRes => {
        const back = {}
        for (const [k, v] of Object.entries(upRes.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) back[k] = v
        res.writeHead(upRes.statusCode, back)
        upRes.pipe(res)
      })
      upstream.setTimeout(CONNECT_MS, () => upstream.destroy(new Error('timed out')))
      upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'x-qa-egress': 'failed' }); res.end('the host could not be reached\n') } else res.destroy() })
      req.pipe(upstream)
    })
    server.on('connect', async (req, socket, head) => {
      socket.on('error', () => {})
      const { host: hostName, port } = splitHostPort(req.url)
      const out = await decide(hostName, port)
      if (out.refused) return refuse(socket, 403, out.refused)
      const upstream = connect(port, out.address)
      const timer = setTimeout(() => upstream.destroy(new Error('timed out')), CONNECT_MS)
      upstream.once('connect', () => {
        clearTimeout(timer)
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head?.length) upstream.write(head)
        upstream.setTimeout(IDLE_MS, () => upstream.destroy())
        upstream.pipe(socket).pipe(upstream)
      })
      upstream.on('error', () => { clearTimeout(timer); if (!socket.destroyed) refuse(socket, 502, 'the host could not be reached') })
      socket.on('close', () => upstream.destroy())
    })
    await opened(server, proxy.listen)
    servers.push(server)
  }

  return {
    servers,
    close: () => Promise.all(servers.map(s => new Promise(resolve => { s.close(() => resolve()); s.closeAllConnections?.() }))),
  }
}

// Run in the container: the config from PANE_FORWARDER. A bad one exits 1,
// and the Provisioner, finding no forwarder, leaves the PR pane as it was.
if (typeof process !== 'undefined' && process.env.PANE_FORWARDER) {
  let config
  try {
    config = JSON.parse(process.env.PANE_FORWARDER)
  } catch {
    console.error('qa-forwarder: PANE_FORWARDER is not JSON')
    process.exit(1)
  }
  createForwarder(config).then(
    () => console.log('qa-forwarder ready'),
    err => { console.error(`qa-forwarder: ${err.message}`); process.exit(1) },
  )
}
