p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/forwarder.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("""// `socket` cut after `ms` idle, unless it is only waiting on the other side:
// paused by backpressure, or with `peer` still draining what it was given.
function idleTimer(socket, peer, ms, cut) {
  socket.setTimeout(ms, () => {
    if (socket.isPaused() || peer?.writableNeedDrain) return socket.setTimeout(ms)
    cut()
  })
}
""", """// What has moved on a socket: bytes read, bytes queued to write, what is
// still queued, and what has yet to reach the kernel.
const movedOn = socket => (socket ? `${socket.bytesRead}/${socket.bytesWritten}/${socket.writableLength}/${socket._handle?.writeQueueSize ?? ''}` : '')
const GRACE_MS = 250

// `socket` is cut once nothing moves. Its own timer fires after `ms` with no
// I/O on it; then it is spared, and the timer re-armed, when:
// - it is only waiting on the other side (`waiting`: paused by backpressure,
//   or `peer` still draining what it was given), and `peer` has moved since
//   the last look; or
// - either side moves within a short grace: a stalled event loop fires
//   timers before the I/O that was due.
// So a tunnel waiting on a slow but steady reader isn't cut, a tunnel where
// nothing moves is cut within `ms` and the grace, and one where each side
// waits on the other, within twice `ms`. The listener stays across re-arms.
function idleTimer(socket, peer, ms, cut, waiting = () => socket.isPaused() || Boolean(peer?.writableNeedDrain)) {
  let peerSeen = movedOn(peer)
  socket.on('timeout', () => {
    const peerNow = movedOn(peer)
    const peerMoved = peerNow !== peerSeen
    peerSeen = peerNow
    if (waiting() && peerMoved) return socket.setTimeout(ms)
    const before = `${movedOn(socket)} ${peerNow}`
    setTimeout(() => {
      if (socket.destroyed) return
      peerSeen = movedOn(peer)
      if (`${movedOn(socket)} ${peerSeen}` !== before) return socket.setTimeout(ms)
      cut()
    }, Math.min(ms, GRACE_MS)).unref()
  })
  socket.setTimeout(ms)
}
""")

sub("""      // idle, but not while the answer only waits on a slow client
      upstream.setTimeout(idleMs, () => {
        if (upRes?.isPaused() || res.writableNeedDrain) return upstream.setTimeout(idleMs)
        upstream.destroy(new Error('idle'))
      })
""", """      // idle, but not while the answer only waits on a slow client that
      // still reads
      upstream.on('socket', socket => idleTimer(socket, res.socket, idleMs, () => upstream.destroy(new Error('idle')), () => Boolean(upRes?.isPaused() || res.writableNeedDrain)))
""")
open(p, 'w').write(s)
print('ok')
