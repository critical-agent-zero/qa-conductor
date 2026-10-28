p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/forwarder.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("""export function idleTimer(socket, peer, ms, cut, waiting = () => socket.isPaused() || Boolean(peer?.writableNeedDrain)) {""",
    """export function idleTimer(socket, peer, ms, cut, { waiting = () => socket.isPaused() || Boolean(peer?.writableNeedDrain), graceMs = Math.min(ms, GRACE_MS) } = {}) {""")
sub("""    }, Math.min(ms, GRACE_MS)).unref()""", """    }, graceMs).unref()""")
sub("""idleTimer(socket, res.socket, idleMs, () => upstream.destroy(new Error('idle')), () => Boolean(upRes?.isPaused() || res.writableNeedDrain)))""",
    """idleTimer(socket, res.socket, idleMs, () => upstream.destroy(new Error('idle')), { waiting: () => Boolean(upRes?.isPaused() || res.writableNeedDrain) }))""")
open(p, 'w').write(s)
print('ok')
