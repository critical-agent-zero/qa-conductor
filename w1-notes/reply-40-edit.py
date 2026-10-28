p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/reply-40.md'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("""1. **The idle timer counted backpressure as idle.** Fixed on all three timers: the forward's, plain HTTP's and both sides of a tunnel.
   - A side that is paused, or whose peer still has `writableNeedDrain`, re-arms the timer instead of being cut.
   - Test: idleMs 300, a host sends 2 MiB and closes, and a client reads one chunk every 100 ms. Every byte arrives, through a tunnel and through plain HTTP.
""", """1. **The idle timer counted backpressure as idle.** Fixed for plain HTTP and for both sides of a tunnel. The inbound forward has no idle timer. Idle now means nothing moved through the connection: `idleTimer` in `lib/forwarder.mjs`.
   - **The trigger is unchanged:** a socket's own timer fires after `idleMs` with no I/O on it.
   - **It is then spared, and re-armed, when either holds:**
     - it is only waiting on the other side (paused by backpressure, or the other side's socket has `writableNeedDrain`), and that side has moved since the last look. "Moved" means its bytes read, its bytes queued or still queued, or its libuv write queue changed;
     - either side moves within a short grace (`min(idleMs, 250 ms)`).
   - **Why the grace:** a stalled event loop fires timers before the I/O that was due, which then looks like idleness.
   - **So:**
     - a tunnel with nothing moving is cut within `idleMs` plus the grace;
     - a tunnel where each side waits on the other is cut within twice `idleMs` plus the grace;
     - one waiting on a slow but steady reader isn't cut.
   - **A bug I hit on the way:** `socket.setTimeout(ms, cb)` adds `cb` with `once`, so the first re-arm in my first version dropped the listener, and the socket was never cut afterwards. Now the listener is added once with `on`, and re-arms only reset the timer. A test re-arms many times and then checks the cut still comes.
   - **Tests:**
     - **The timer's rules, at 100–200 ms with stand-in sockets on real timers, deterministic:**
       - nothing moving is cut after `ms` and the grace;
       - a socket waiting on a peer that moved since the last look is spared, then cut;
       - a paused socket whose peer keeps moving survives 10 re-arms, then is cut once the peer stops;
       - each side waiting on the other is still cut;
       - a stalled event loop (a 200 ms busy-wait past the deadline) is spared by I/O that lands in the grace.
     - **End to end, your scenario:** a host sends 2 MiB and closes, and a client reads one chunk every 100 ms. Every byte arrives through a tunnel and through plain HTTP.
     - **The other direction:** a PR uploads 16 MiB to a host that reads one chunk every 100 ms for 2 s, and every byte arrives.
   - **Judgment call: the end-to-end tests use `idleMs` 1000, not 300.**
     - On this Mac, the loopback's kernel buffers sometimes held a steady reader's bytes out of the forwarder's sight for more than 550 ms: no byte read, queued or handed to the kernel on either socket. The reader was reading one chunk every 100 ms.
     - At 300 ms, that cut 2 of 45 runs under load, with the fix in place.
     - What the forwarder can see, it handles. The rules are pinned at 100–200 ms by the deterministic tests above.
   - **Limit:** bytes already in the kernel's buffers move where no timer sees them. A reader that drains them slower than one idle period can still be cut at the tail. At the 5-minute default, that means a reader slower than the kernel's buffers per 5 minutes.
""")
sub("""   Clean closes keep `destroySoon()`. Test: a host that resets mid-stream gives the PR `ECONNRESET` on the forward, a tunnel and plain HTTP; so does an idle cut. The two existing idle tests now expect `ECONNRESET`.""",
    """   Clean closes keep `destroySoon()`. Tests:
   - a host that resets mid-stream gives the PR `ECONNRESET`, through a tunnel and through the forward;
   - a PR that resets mid-tunnel gives the host `ECONNRESET`;
   - a plain-HTTP answer cut partway gives an HTTP/1.0 client, whose answer is close-delimited, `ECONNRESET` rather than a clean end;
   - an idle cut, and an upstream error after the `200`, give `ECONNRESET`. The two existing tests now expect it.""")
open(p, 'w').write(s)
print('ok')
