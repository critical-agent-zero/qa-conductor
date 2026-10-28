p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/reply-40.md'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("""Fixed for plain HTTP and for both sides of a tunnel. The inbound forward has no idle timer. Idle now means nothing moved through the connection: `idleTimer` in `lib/forwarder.mjs`.""",
    """Fixed for plain HTTP and for tunnels. The inbound forward has no idle timer. Idle now means nothing moved through the connection: `idleTimer` in `lib/forwarder.mjs`.
   - **A tunnel now has one timer, on the PR's side,** in place of one per side. Every byte either way is read or written there, and the host's side counts as its peer.""")
sub("""       - a paused socket whose peer keeps moving survives 10 re-arms, then is cut once the peer stops;""",
    """       - a paused socket whose peer keeps moving survives about ten re-arms, then is cut once the peer stops;""")
sub("""       - a stalled event loop (a 200 ms busy-wait past the deadline) is spared by I/O that lands in the grace.""",
    """       - a stalled event loop (a 200 ms busy-wait past the deadline) is spared by I/O that lands in the grace;
       - a socket gone during the grace isn't cut.""")
open(p, 'w').write(s)
print('ok')
