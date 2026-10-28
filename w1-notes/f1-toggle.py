import sys
p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/forwarder.mjs'
s = open(p).read()
a = "    if (socket.isPaused() || peer?.writableNeedDrain) return socket.setTimeout(ms)\n"
b = "    if (false) return socket.setTimeout(ms)\n"
if sys.argv[1] == 'on':
    assert s.count(a) == 1
    s = s.replace(a, b)
else:
    assert s.count(b) == 1
    s = s.replace(b, a)
open(p, 'w').write(s)
print('F1', sys.argv[1])
