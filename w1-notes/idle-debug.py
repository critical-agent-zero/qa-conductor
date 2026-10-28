import sys
p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/forwarder.mjs'
s = open(p).read()
a = """  socket.setTimeout(ms, () => {
    if (socket.isPaused() || peer?.writableNeedDrain) return socket.setTimeout(ms)
    cut()
  })"""
b = """  socket.setTimeout(ms, () => {
    if (socket.isPaused() || peer?.writableNeedDrain) return socket.setTimeout(ms)
    if (process.env.IDLE_DEBUG) process.stderr.write(`IDLE-CUT local=${socket.localPort} remote=${socket.remotePort} paused=${socket.isPaused()} needDrain=${socket.writableNeedDrain} len=${socket.writableLength} peerLen=${peer?.writableLength} peerPaused=${peer?.isPaused()} read=${socket.bytesRead} written=${socket.bytesWritten}\\n`)
    cut()
  })"""
if sys.argv[1] == 'on':
    assert s.count(a) == 1
    s = s.replace(a, b)
else:
    assert s.count(b) == 1
    s = s.replace(b, a)
open(p, 'w').write(s)
print(sys.argv[1])
