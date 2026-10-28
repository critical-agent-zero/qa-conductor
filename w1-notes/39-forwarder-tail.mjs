// --- Names ------------------------------------------------------------------------

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const isHostname = h => h.length <= 253 && h.split('.').length >= 2 && h.split('.').every(l => LABEL.test(l)) && !/^\d+$/.test(h.split('.').at(-1))
// Names that only ever name this host or a private network: never listed.
const PRIVATE_NAMES = ['localhost', 'local', 'internal', 'localdomain', 'home.arpa', 'lan', 'intranet', 'invalid', 'onion']
const isPrivateName = h => PRIVATE_NAMES.some(n => h === n || h.endsWith(`.${n}`))

// A host as compared: as the URL parser has it, so lowercase, punycode, with
// no trailing dot, an IPv4 address in any form (`0x7f.1`) as dotted decimal,
// and an IPv6 one compressed, without brackets. null when it is none, or an
// IPv6 address with a zone.
function canonicalHost(raw) {
  let h = String(raw ?? '').trim()
  const bracketed = /^\[([^\]]*)\]$/.exec(h)
  if (bracketed) h = bracketed[1]
  if (h === '' || h.includes('%')) return null
  try {
    if (h.includes(':')) return net.isIPv6(h) ? new URL(`http://[${h}]/`).hostname.slice(1, -1) : null
    return new URL(`http://${h}/`).hostname.replace(/\.$/, '') || null
  } catch {
    return null
  }
}

// `host:port` (a CONNECT target, or an entry) split, IPv6 in brackets; port
// null when there is none. `bracketed` says the host was.
function splitHostPort(text) {
  const s = String(text ?? '').trim()
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(s)
  if (bracket) return { host: bracket[1], port: bracket[2] === undefined ? null : Number(bracket[2]), bracketed: true }
  const colon = s.lastIndexOf(':')
  if (colon !== -1 && s.indexOf(':') === colon) return { host: s.slice(0, colon), port: /^\d+$/.test(s.slice(colon + 1)) ? Number(s.slice(colon + 1)) : NaN, bracketed: false }
  return { host: s, port: null, bracketed: false }
}
const isPort = p => Number.isInteger(p) && p >= 1 && p <= 65535

// --- The allowlist ---------------------------------------------------------------

// The allowlist's entries, checked: `api.example.com` (that host only),
// `*.example.com` (any host under it, not itself), or a public IP address
// (an IPv6 one in brackets), each with an optional `:port`. Without a port,
// 80 and 443. Anything else throws, so a typo never opens more than meant: a
// private address in any form, a name only this host or its network has
// (`localhost`, `*.internal`), a bad port. A wildcard is as wide as written:
// `*.github.io` admits every site under it.
export function parseAllowlist(entries) {
  if (entries === undefined || entries === null) return []
  if (!Array.isArray(entries)) throw new Error('the egress allowlist must be an array of hosts')
  return entries.map((entry, i) => {
    if (typeof entry !== 'string') throw new Error(`egress[${i}] must be a string`)
    const { host: raw, port, bracketed } = splitHostPort(entry)
    if (port !== null && !isPort(port)) throw new Error(`egress[${i}] has a bad port: ${JSON.stringify(entry)}`)
    const wildcard = raw.startsWith('*.')
    const given = wildcard ? raw.slice(2) : raw
    if (given.includes(':') && !bracketed) throw new Error(`egress[${i}]: an IPv6 address goes in brackets: ${JSON.stringify(entry)}`)
    const name = canonicalHost(given)
    if (name !== null && net.isIP(name)) {
      if (wildcard) throw new Error(`egress[${i}]: an IP address takes no wildcard: ${JSON.stringify(entry)}`)
      const blocked = blockedAddress(name)
      if (blocked) throw new Error(`egress[${i}]: ${name} is ${blocked}, which is always refused`)
    } else if (name === null || !isHostname(name)) {
      throw new Error(`egress[${i}] must be a host name, *.domain or a public IP address, with an optional :port: ${JSON.stringify(entry)}`)
    } else if (isPrivateName(name)) {
      throw new Error(`egress[${i}]: ${name} is a name only this host or its network has, which is always refused`)
    }
    return { host: name, wildcard, ports: port === null ? DEFAULT_PORTS : [port] }
  })
}

const listed = (rules, host, port) => rules.some(r => r.ports.includes(port) && (r.wildcard ? host.endsWith(`.${r.host}`) : host === r.host))

// Whether a request may go to host:port, and to which address: { address }
// or { refused: reason }. `lookup(host)` resolves to every address of host.
// The host is compared as the URL parser has it.
export async function checkTarget(rules, host, port, lookup) {
  if (!isPort(port)) return { refused: 'no valid port' }
  const name = canonicalHost(host)
  if (name === null) return { refused: 'not a host name' }
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

// Headers that are the connection's own, never passed on (RFC 9110 §7.6.1),
// and so is any header a Connection header names.
const HOP_BY_HOP = new Set(['connection', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
function endToEnd(headers) {
  const named = new Set(String(headers.connection ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  const out = {}
  for (const [k, v] of Object.entries(headers)) if (!HOP_BY_HOP.has(k.toLowerCase()) && !named.has(k.toLowerCase())) out[k] = v
  return out
}

const STATUS_TEXT = { 400: 'Bad Request', 403: 'Forbidden', 502: 'Bad Gateway' }
// `X-QA-Egress` says `refused` (the forwarder said no) or `failed` (the host
// couldn't be reached), on both paths.
function answer(socket, status, kind, reason) {
  const text = `${reason}\n`
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nX-QA-Egress: ${kind}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`)
}

const defaultLookup = host => dns.lookup(host, { all: true, verbatim: true })
const defaultConnect = (port, address) => net.connect({ port, host: address })
const LOG_MAX = 300

// The config, checked whole before anything listens: { forward?: { listen,
// to: 'host:port' }, proxy?: { listen, allow }, host?, timeouts?: {
// connectMs, idleMs } }, with at least one of forward and proxy.
function checkConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('the config must be an object with forward, proxy or both')
  const { forward = null, proxy = null, host = '0.0.0.0', timeouts = {} } = config
  if (!forward && !proxy) throw new Error('the config must be an object with forward, proxy or both')
  if (typeof host !== 'string' || !net.isIP(host)) throw new Error('host must be an IP address to listen on')
  let to = null
  if (forward) {
    to = splitHostPort(forward.to)
    if (!to.host || !isPort(to.port) || !isPort(forward.listen)) throw new Error('forward needs listen (a port) and to (host:port)')
  }
  let rules = null
  if (proxy) {
    rules = parseAllowlist(proxy.allow)
    if (!isPort(proxy.listen)) throw new Error('proxy needs listen (a port)')
  }
  const ms = (v, d) => (Number.isSafeInteger(v) && v > 0 ? v : d)
  return { forward: forward && { listen: forward.listen, to }, proxy: proxy && { listen: proxy.listen, rules }, host, connectMs: ms(timeouts?.connectMs, 10_000), idleMs: ms(timeouts?.idleMs, 5 * 60_000) }
}

// config as checkConfig says; lookup, connect and log are for tests.
// Resolves once every server listens. close() ends every connection.
export async function createForwarder(config, { lookup = defaultLookup, connect = defaultConnect, log = line => console.error(line) } = {}) {
  const { forward, proxy, host, connectMs, idleMs } = checkConfig(config)
  const servers = []
  // every connection in and out, so close() can end them
  const sockets = new Set()
  const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); return socket }
  const opened = (server, port) => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.off('error', reject); resolve() })
  })

  if (forward) {
    // half-open both ways, so a client that ends its request still gets the answer
    const server = net.createServer({ allowHalfOpen: true }, client => {
      const upstream = track(net.connect({ host: forward.to.host, port: forward.to.port, allowHalfOpen: true }))
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
      client.on('close', () => upstream.destroy())
      upstream.on('close', () => client.destroy())
      client.pipe(upstream).pipe(client)
    })
    server.on('connection', track)
    servers.push(server)
  }

  if (proxy) {
    const say = (hostName, port, reason) => {
      const name = canonicalHost(hostName)
      const where = name === null ? JSON.stringify(String(hostName ?? '').slice(0, 100)) : name.includes(':') ? `[${name}]` : name
      const line = `qa-egress refused ${where}:${port}: ${reason}`
      log(line.length > LOG_MAX ? `${line.slice(0, LOG_MAX)}…` : line)
    }
    const decide = async (hostName, port) => {
      const out = await checkTarget(proxy.rules, hostName, port, lookup)
      if (out.refused) say(hostName, port, out.refused)
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
      const failed = () => {
        if (res.headersSent) return res.destroy()
        res.writeHead(502, { 'x-qa-egress': 'failed', 'content-type': 'text/plain' })
        res.end('the host could not be reached\n')
      }
      const headers = endToEnd(req.headers)
      headers.host = target.host
      const upstream = http.request({
        method: req.method, path: `${target.pathname}${target.search}`, headers, setHost: false,
        createConnection: () => track(connect(port, out.address)),
      }, upRes => {
        if (!(upRes.statusCode >= 100 && upRes.statusCode <= 999)) { upRes.destroy(); upstream.destroy(); return failed() }
        res.writeHead(upRes.statusCode, endToEnd(upRes.headers))
        upRes.pipe(res)
        // an answer cut partway through is cut for the client too
        upRes.on('close', () => { if (!upRes.complete) res.destroy() })
      })
      // a connect that never completes is bounded, and so is an idle answer
      const connecting = setTimeout(() => upstream.destroy(new Error('timed out')), connectMs)
      upstream.on('socket', socket => { if (socket.connecting) socket.once('connect', () => clearTimeout(connecting)); else clearTimeout(connecting) })
      upstream.setTimeout(idleMs, () => upstream.destroy(new Error('idle')))
      upstream.on('error', () => { clearTimeout(connecting); failed() })
      upstream.on('close', () => clearTimeout(connecting))
      req.pipe(upstream)
    })
    server.on('connect', async (req, socket, head) => {
      socket.on('error', () => {})
      const { host: hostName, port } = splitHostPort(req.url)
      const out = await decide(hostName, port)
      if (out.refused) return answer(socket, 403, 'refused', out.refused)
      const upstream = track(connect(port, out.address))
      let open = false
      const connecting = setTimeout(() => upstream.destroy(new Error('timed out')), connectMs)
      upstream.once('connect', () => {
        clearTimeout(connecting)
        open = true
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head?.length) upstream.write(head)
        // either side idle, or either side gone, ends both
        upstream.setTimeout(idleMs, () => upstream.destroy())
        socket.setTimeout(idleMs, () => socket.destroy())
        upstream.pipe(socket).pipe(upstream)
      })
      // before the 200 a failure is answered; after it, the tunnel just ends
      upstream.on('error', () => { clearTimeout(connecting); if (!open && !socket.destroyed) answer(socket, 502, 'failed', 'the host could not be reached') })
      upstream.on('close', () => { clearTimeout(connecting); if (open) socket.destroy() })
      socket.on('close', () => upstream.destroy())
    })
    server.on('connection', track)
    servers.push(server)
  }

  // every server listens only once the whole config is known to be good
  const ports = [forward?.listen, proxy?.listen]
  try {
    for (const [i, server] of servers.entries()) await opened(server, ports.filter(Boolean)[i])
  } catch (err) {
    for (const server of servers) server.close()
    throw err
  }

  return {
    servers,
    close: () => {
      for (const socket of sockets) socket.destroy()
      return Promise.all(servers.map(s => new Promise(resolve => { if (!s.listening) return resolve(); s.close(() => resolve()) })))
    },
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
