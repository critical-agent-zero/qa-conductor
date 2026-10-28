import json
F = 'lib/forwarder.mjs'
TF = ['test/forwarder.test.mjs']
m = [
    ('N1', "  socket.on('timeout', () => {\n    const peerNow", "  socket.once('timeout', () => {\n    const peerNow"),
    ('N2', "    if (waiting() && peerMoved) return socket.setTimeout(ms)\n", ""),
    ('N3', "    if (waiting() && peerMoved) return socket.setTimeout(ms)\n", "    if (waiting()) return socket.setTimeout(ms)\n"),
    ('N4', """    setTimeout(() => {
      if (socket.destroyed) return
      peerSeen = movedOn(peer)
      if (`${movedOn(socket)} ${peerSeen}` !== before) return socket.setTimeout(ms)
      cut()
    }, graceMs).unref()""", "    cut()"),
    ('N5', "      if (`${movedOn(socket)} ${peerSeen}` !== before) return socket.setTimeout(ms)\n", ""),
    ('N6', "{ waiting: () => Boolean(upRes?.isPaused() || res.writableNeedDrain) }", "{ waiting: () => false }"),
    ('N7', "      upstream.on('socket', socket => idleTimer(", "      upstream.on('nosuchevent', socket => idleTimer("),
    ('N8', "        idleTimer(socket, upstream, idleMs, () => { reset(socket); reset(upstream) })\n", ""),
    ('N9', "        idleTimer(socket, upstream, idleMs, () => { reset(socket); reset(upstream) })\n", "        idleTimer(socket, upstream, idleMs, () => { reset(socket) })\n"),
    ('N10', "const movedOn = socket => (socket ? `${socket.bytesRead}/${socket.bytesWritten}/${socket.writableLength}/${socket._handle?.writeQueueSize ?? ''}` : '')", "const movedOn = socket => (socket ? `${socket.bytesRead}` : '')"),
    ('N11', "      if (socket.destroyed) return\n      peerSeen", "      peerSeen"),
]
json.dump([{'id': i, 'file': F, 'old': o, 'new': n, 'tests': TF} for (i, o, n) in m], open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-40d.json', 'w'), indent=1)
print(len(m))
