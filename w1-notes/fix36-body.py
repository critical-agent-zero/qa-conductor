p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/pr8c-body.md'
s = open(p).read()


def sub(a, b):
    global s
    assert a in s, a[:70]
    s = s.replace(a, b, 1)


sub("**Draft. Depends on #35; review only the commits after 5cf2b16** (#35's head): `5cf2b16..0991ab1`, 3 commits, 13 files, +1,024 −44. The rest of the diff is #35 and #34. This branch follows them by merging, never by rebasing.",
    "**Draft. Depends on #35; review only the commits after 79e3efc** (#35's head): `79e3efc..31056d0`, 4 commits, 13 files, +1,221 −45. The rest of the diff is #35 and #34. This branch follows them by merging, never by rebasing.\n\n"
    "**Round 2:** `31056d0` fixes the review of `0991ab1`; the answer, item by item, is in the comments.")
sub("""  So a hanging inspector can add up to 30 s per step to a boot.""",
    """  Each call also gets a signal that aborts at its timeout, so a call that heeds it stops. A hanging inspector can add up to 150 s to a boot: an open and a seeded read per pane, one after the other, then the ready reads together. The budget is per call, not per boot.""")
sub("""- **D. Errors from the inspector are shown to the harness as they come.** A database error may quote a value. They go only to `GET /api/data`, never the event stream or a log.""",
    """- **D. Errors from the inspector are shown to the harness as they come.** A database error may quote a value. They go only to `GET /api/data`, never the event stream or a log. They are kept per span: `errors.boot` (the open, seeded and ready reads, never erased by a later success) and `errors.session` (the latest read).""")
sub("""- **E. `GET /api/data` isn't paged.** It holds both spans' diffs, so a mass delete of 10,000 rows sends those rows. It is bounded by the snapshots' 32 MB a pane. PR D can ask for less if the panel needs it.""",
    """- **E. `GET /api/data` lists in part, and isn't paged.**
  - A diff lists at most 50 rows of each kind per collection, and divergence 50 changes, within about 4 MB of rows per answer. Whole counts sit beside the lists.
  - The JSON is built once per state and trust, and every reader gets that string.
  - The review's case (4 tables of 10,000 rows, rewritten at boot and again in the session) gives 292 KB. It takes about 0.8 s to build, once per snapshot.
  - Paging the rest is left for later.""")
sub("""- **G. Probes close at the next boot, at teardown before `teardownSession`, and when a boot is superseded or fails.** The in-flight boot's probes close at teardown too.""",
    """- **G. Probes close at the next boot, at teardown before `teardownSession`, and when a boot is superseded or fails.** The in-flight boot's probes close at teardown too. The next boot waits for them to close before it builds.
- **I. A pane whose ready read failed keeps its S0,** and its first later snapshot is its baseline, so the PR's boot changes still show. A failed Snapshot now leaves its pane with no session span rather than a stale one. A Re-baseline is both panes or neither. A span with a pane missing says `complete: false`.""")
sub("""  - S0 goes once the boot span is known.""",
    """  - S0 goes once its pane has a baseline.""")
sub("""  - the event stream gets `{kind: 'capture', pane, phase, ok}`.""",
    """  - the event stream gets `{kind: 'capture', pane, phase, ok}` for the `seeded` and `ready` phases only.""")
sub("""- **Tests:** 789 passed on Node 24 and on Node 22 (`npm test`). New here:
  - `test/data-capture.test.mjs`: 10 tests;
  - 9 server tests: no inspector, the spans and masking, trusted vs advisory, the lifecycle and races, superseded and failed boots, the route checks, start-time checks;""",
    """- **Tests:** 796 passed on Node 24 and on Node 22 (`npm test`). New here:
  - `test/data-capture.test.mjs`: 11 tests;
  - 11 server tests: no inspector, the spans and masking, trusted vs advisory, the lifecycle and races, superseded and failed boots, a superseded boot's events, the wait for probes to close, the route checks, start-time checks;""")
sub("""  Two survive as equivalent:""",
    """  Round 2 added 14 more on the review's fixes, all killed: the timeout signal, S0 dropped, no late baseline, a stale latest kept, a partial re-baseline, the boot error erased, `complete` always true, no listing cap, no cache, a cache that ignores trust, `now` events, superseded events, closing not awaited, and the version not bumped on a snapshot.

  Two survive as equivalent:""")
open(p, 'w').write(s)
print('ok')
