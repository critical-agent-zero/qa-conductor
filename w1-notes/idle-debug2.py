import sys
p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/forwarder.mjs'
s = open(p).read()
a = """      if (`${movedOn(socket)} ${peerSeen}` !== before) return socket.setTimeout(ms)
      cut()"""
b = """      if (`${movedOn(socket)} ${peerSeen}` !== before) return socket.setTimeout(ms)
      if (process.env.IDLE_DEBUG) process.stderr.write(`IDLE-CUT local=${socket.localPort} remote=${socket.remotePort} waiting=${waiting()} before=${before} paused=${socket.isPaused()} peerPaused=${peer?.isPaused()} t=${Date.now() % 100000}\\n`)
      cut()"""
if sys.argv[1] == 'on':
    assert s.count(a) == 1
    s = s.replace(a, b)
else:
    assert s.count(b) == 1
    s = s.replace(b, a)
open(p, 'w').write(s)
print(sys.argv[1])
