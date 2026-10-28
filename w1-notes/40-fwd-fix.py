p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/forwarder.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("""// `#x`), a backslash, whitespace, or an escape. So `api.example.com@evil.org`
// is refused, never read as evil.org.
const NOT_A_HOST = /[@/?#\\\\%\\s]/""", """// `#x`), a backslash, whitespace, an escape, or a slash that only looks like
// one (U+2044, U+2215, U+29F5). So `api.example.com@evil.org` is refused,
// never read as evil.org. A CONNECT target is never percent-decoded either:
// one with an escape is refused, though the plain-HTTP path's URL parse
// decodes its host.
const NOT_A_HOST = /[@/?#\\\\%\\s\\u2044\\u2215\\u29f5]/""")

sub("""  if (forward) {
    to = splitHostPort(forward.to)
    if (!to.host || !isPort(to.port) || !isPort(forward.listen)) throw new Error('forward needs listen (a port) and to (host:port)')
  }""", """  if (forward) {
    to = splitHostPort(forward.to)
    if (!to.host || /\\s/.test(String(forward.to)) || !isPort(to.port) || !isPort(forward.listen)) throw new Error('forward needs listen (a port) and to (host:port)')
  }""")

# helpers: a reset where one is meant, and an idle timer that backpressure doesn't trip
sub("""const defaultLookup = host => dns.lookup(host, { all: true, verbatim: true })""",
    """// A failure or an idle cut reaches the other side as a reset, never a clean
// end, which a close-delimited stream would read as complete. A socket still
// connecting, or with no handle, is simply destroyed.
function reset(socket) {
  if (!socket || socket.destroyed) return
  if (socket.connecting || !socket._handle || typeof socket.resetAndDestroy !== 'function') return socket.destroy()
  try {
    socket.resetAndDestroy()
  } catch {
    socket.destroy()
  }
}

// `socket` cut after `ms` idle, unless it is only waiting on the other side:
// paused by backpressure, or with `peer` still draining what it was given.
function idleTimer(socket, peer, ms, cut) {
  socket.setTimeout(ms, () => {
    if (socket.isPaused() || peer?.writableNeedDrain) return socket.setTimeout(ms)
    cut()
  })
}

const defaultLookup = host => dns.lookup(host, { all: true, verbatim: true })""")

sub("""      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
      client.on('close', () => upstream.destroy())
      upstream.on('close', () => client.destroySoon())""", """      client.on('error', () => reset(upstream))
      upstream.on('error', () => reset(client))
      client.on('close', () => upstream.destroy())
      upstream.on('close', () => client.destroySoon())""")

sub("""      const failed = () => {
        if (res.headersSent) return res.destroy()""", """      let upRes = null
      const failed = () => {
        if (res.headersSent) return reset(res.socket)""")
sub("""      }, upRes => {
        if (!(upRes.statusCode >= 100 && upRes.statusCode <= 999)) { upRes.destroy(); upstream.destroy(); return failed() }
        res.writeHead(upRes.statusCode, endToEnd(upRes.headers))
        upRes.pipe(res)
        // an answer cut partway through is cut for the client too
        upRes.on('close', () => { if (!upRes.complete) res.destroy() })
      })""", """      }, answerOf => {
        upRes = answerOf
        if (!(upRes.statusCode >= 100 && upRes.statusCode <= 999)) { upRes.destroy(); upstream.destroy(); return failed() }
        res.writeHead(upRes.statusCode, endToEnd(upRes.headers))
        upRes.pipe(res)
        // an answer cut partway through is cut for the client too, as a reset
        upRes.on('close', () => { if (!upRes.complete) reset(res.socket) })
      })""")
sub("""      upstream.setTimeout(idleMs, () => upstream.destroy(new Error('idle')))""",
    """      // idle, but not while the answer only waits on a slow client
      upstream.setTimeout(idleMs, () => {
        if (upRes?.isPaused() || res.writableNeedDrain) return upstream.setTimeout(idleMs)
        upstream.destroy(new Error('idle'))
      })""")

sub("""      // A PR side that fails ends the upstream at once, and one that closes
      // ends it once what is queued is written. Both are set before the
      // lookup, so a client gone during it gets nothing dialled.
      let upstream = null
      socket.on('error', () => upstream?.destroy())
      socket.on('close', () => upstream?.destroySoon())""", """      // A PR side that fails ends the upstream at once, with a reset, and one
      // that closes ends it once what is queued is written. Both are set
      // before the lookup. One that resets during it gets nothing dialled;
      // one that leaves with a FIN is dialled, then torn down at once.
      let upstream = null
      socket.on('error', () => reset(upstream))
      socket.on('close', () => upstream?.destroySoon())""")
sub("""        // either side idle, or either side gone, ends both
        upstream.setTimeout(idleMs, () => upstream.destroy())
        socket.setTimeout(idleMs, () => socket.destroy())""", """        // either side idle, or either side gone, ends both; a side only
        // waiting on the other's backpressure isn't idle
        idleTimer(upstream, socket, idleMs, () => { reset(upstream); reset(socket) })
        idleTimer(socket, upstream, idleMs, () => { reset(socket); reset(upstream) })""")
sub("""      upstream.on('error', () => { clearTimeout(connecting); if (!open && !socket.destroyed) answer(socket, 502, 'failed', 'the host could not be reached'); else if (open) socket.destroy() })""",
    """      upstream.on('error', () => { clearTimeout(connecting); if (!open && !socket.destroyed) answer(socket, 502, 'failed', 'the host could not be reached'); else if (open) reset(socket) })""")

sub("""// Run in the container: the config from PANE_FORWARDER. A bad one exits 1,
// and the Provisioner, finding no forwarder, leaves the PR pane as it was.""",
    """// Run in the container: the config from PANE_FORWARDER. A bad one exits 1.
// The Provisioner, finding no forwarder ready, then puts the PR pane on an
// ordinary network, and its isolation verdict says egress isn't restricted.""")
open(p, 'w').write(s)
print('ok')
