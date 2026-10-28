p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/forwarder.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("""const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const isHostname = h => h.length <= 253 && h.split('.').length >= 2 && h.split('.').every(l => LABEL.test(l)) && !/^\\d+$/.test(h.split('.').at(-1))""",
    """const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
// At least two labels. (A name whose last label is numeric never gets here:
// canonicalHost reads it as IPv4, or refuses it.)
const isHostname = h => h.length <= 253 && h.split('.').length >= 2 && h.split('.').every(l => LABEL.test(l))""")

sub("""// A host as compared: as the URL parser has it, so lowercase, punycode, with
// no trailing dot, an IPv4 address in any form (`0x7f.1`) as dotted decimal,
// and an IPv6 one compressed, without brackets. null when it is none, or an
// IPv6 address with a zone.
function canonicalHost(raw) {
  let h = String(raw ?? '').trim()
  const bracketed = /^\\[([^\\]]*)\\]$/.exec(h)
  if (bracketed) h = bracketed[1]
  if (h === '' || h.includes('%')) return null
  try {
    if (h.includes(':')) return net.isIPv6(h) ? new URL(`http://[${h}]/`).hostname.slice(1, -1) : null
    return new URL(`http://${h}/`).hostname.replace(/\\.$/, '') || null
  } catch {
    return null
  }
}""", """// A host as compared: as the URL parser has it, so lowercase, punycode, with
// no trailing dot, an IPv4 address in any form (`0x7f.1`) as dotted decimal,
// and an IPv6 one compressed, without brackets. null when it is none, an
// IPv6 address with a zone, or anything the parse would do more than
// normalise: userinfo, a path, a query or a fragment (`a@b`, `host/path`,
// `#x`), a backslash, whitespace, or an escape. So `api.example.com@evil.org`
// is refused, never read as evil.org.
const NOT_A_HOST = /[@/?#\\\\%\\s]/
function canonicalHost(raw) {
  let h = String(raw ?? '')
  const bracketed = /^\\[([^\\]]*)\\]$/.exec(h)
  if (bracketed) h = bracketed[1]
  if (h === '' || NOT_A_HOST.test(h)) return null
  try {
    if (h.includes(':')) return net.isIPv6(h) ? new URL(`http://[${h}]/`).hostname.slice(1, -1) : null
    const url = new URL(`http://${h}/`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.hostname.replace(/\\.$/, '') || null
  } catch {
    return null
  }
}""")

sub("""// `host:port` (a CONNECT target, or an entry) split, IPv6 in brackets; port
// null when there is none. `bracketed` says the host was.
function splitHostPort(text) {
  const s = String(text ?? '').trim()""", """// `host:port` (a CONNECT target, or an entry) split, IPv6 in brackets; port
// null when there is none. `bracketed` says the host was. Nothing is trimmed:
// whitespace makes it no host.
function splitHostPort(text) {
  const s = String(text ?? '')""")

# the inbound forward: an upstream that closes ends the client once what is
# queued for it is written
sub("""      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
      client.on('close', () => upstream.destroy())
      upstream.on('close', () => client.destroy())
      client.pipe(upstream).pipe(client)""", """      // A side that fails ends the other at once; a side that closes ends the
      // other once what is queued for it is written (destroySoon), so a slow
      // reader still gets the tail. Its idle timer is the conductor's.
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
      client.on('close', () => upstream.destroySoon())
      upstream.on('close', () => client.destroySoon())
      client.pipe(upstream).pipe(client)""")

# plain HTTP: a request the PR abandons takes its upstream with it
sub("""    const server = http.createServer(async (req, res) => {
      // only proxy requests, and only plain http: HTTPS goes through CONNECT
      let target""", """    const server = http.createServer(async (req, res) => {
      // a client gone while the name was looked up: nothing is dialled
      let gone = false
      res.on('close', () => { gone = true })
      // only proxy requests, and only plain http: HTTPS goes through CONNECT
      let target""")
sub("""      const out = await decide(target.hostname, port)
      if (out.refused) {
        res.writeHead(403, { 'x-qa-egress': 'refused', 'content-type': 'text/plain' })""", """      const out = await decide(target.hostname, port)
      if (gone) return
      if (out.refused) {
        res.writeHead(403, { 'x-qa-egress': 'refused', 'content-type': 'text/plain' })""")
sub("""      upstream.on('close', () => clearTimeout(connecting))
      req.pipe(upstream)""", """      upstream.on('close', () => clearTimeout(connecting))
      // a client gone before its answer is done takes the upstream with it
      res.on('close', () => { if (!res.writableFinished) upstream.destroy() })
      req.pipe(upstream)""")

sub("""    server.on('connect', async (req, socket, head) => {
      socket.on('error', () => {})
      const { host: hostName, port } = splitHostPort(req.url)
      const out = await decide(hostName, port)
      if (out.refused) return answer(socket, 403, 'refused', out.refused)
      const upstream = track(connect(port, out.address))""", """    server.on('connect', async (req, socket, head) => {
      // A PR side that fails ends the upstream at once, and one that closes
      // ends it once what is queued is written. Both are set before the
      // lookup, so a client gone during it gets nothing dialled.
      let upstream = null
      socket.on('error', () => upstream?.destroy())
      socket.on('close', () => upstream?.destroySoon())
      const { host: hostName, port } = splitHostPort(req.url)
      const out = await decide(hostName, port)
      if (socket.destroyed) return
      if (out.refused) return answer(socket, 403, 'refused', out.refused)
      upstream = track(connect(port, out.address))""")
sub("""      // before the 200 a failure is answered; after it, the tunnel just ends
      upstream.on('error', () => { clearTimeout(connecting); if (!open && !socket.destroyed) answer(socket, 502, 'failed', 'the host could not be reached') })
      upstream.on('close', () => { clearTimeout(connecting); if (open) socket.destroy() })
      socket.on('close', () => upstream.destroy())""", """      // before the 200 a failure is answered; after it, the tunnel ends: at
      // once on an error, else once what is queued for the PR is written
      upstream.on('error', () => { clearTimeout(connecting); if (!open && !socket.destroyed) answer(socket, 502, 'failed', 'the host could not be reached'); else if (open) socket.destroy() })
      upstream.on('close', () => { clearTimeout(connecting); if (open) socket.destroySoon() })""")

# a listen that fails frees what did listen before it rejects
sub("""  } catch (err) {
    for (const server of servers) server.close()
    throw err
  }""", """  } catch (err) {
    await Promise.all(servers.map(server => new Promise(resolve => (server.listening ? server.close(() => resolve()) : resolve()))))
    throw err
  }""")

sub("""// config as checkConfig says; lookup, connect and log are for tests.""",
    """// config as checkConfig says; lookup, connect and log are for tests.
// Allowlist entries and CONNECT targets get no trimming: whitespace is an
// error, never something to read past.""")
open(p, 'w').write(s)
print('ok')
