W = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/'
s = open(W + 'notes/pr36-live.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("**Draft. Depends on #35; review only the commits after 79e3efc** (#35's head): `79e3efc..31056d0`, 4 commits, 13 files, +1,221 −45.",
    "**Draft. Depends on #35; review only the commits after 2ec0bba** (#35's head): `2ec0bba..a2bbc7c`, 5 commits, 13 files, +1,547 −45.")
sub("**Round 2:** `31056d0` fixes the review of `0991ab1`; the answer, item by item, is in the comments.",
    "**Round 2:** `31056d0` fixes the review of `0991ab1`. **Round 3:** `a2bbc7c` fixes round 2's review of `31056d0`, and #37's round-2 high (the `unreadable` flag). The answers, item by item, are in the comments.")
sub("They are kept per span: `errors.boot` (the open, seeded and ready reads, never erased by a later success) and `errors.session` (the latest read).",
    "They are kept per span: `errors.boot` (the open, seeded and ready reads, each reason kept, never erased by a later success) and `errors.session` (the latest read).")
sub("""- **E. `GET /api/data` lists in part, and isn't paged.**
  - A diff lists at most 50 rows of each kind per collection, and divergence 50 changes, within about 4 MB of rows per answer. Whole counts sit beside the lists.
  - The JSON is built once per state and trust, and every reader gets that string.
  - The review's case (4 tables of 10,000 rows, rewritten at boot and again in the session) gives 292 KB. It takes about 0.8 s to build, once per snapshot.
  - Paging the rest is left for later.""", """- **E. `GET /api/data` lists in part, and isn't paged. An answer is about 6 MB at most.**
  - A diff lists at most 1,000 collections, the changed first, and 50 rows, changes and dropped and added fields of each kind a collection. A span lists at most 500 flags, red first. All of those lists share 2 MB a span, and a collection the budget cut says `cut`. Whole counts sit beside every list (`counts`, `changesCount`, `collectionsCount`, `flagsCount`).
  - The JSON is built once per state and trust, and every reader gets that string. One that fails to build fails again at once until the state changes.
  - Measured: round 1's case (4 tables of 10,000 rows, rewritten twice) gives 292 KB; round 2's (100 tables of 1,600 columns, added then dropped) 2.1 MB in 0.6 s; 1,000 collections of 20 wide rows rewritten twice, 5.6 MB in 0.56 s.
  - Paging the rest is left for later.""")
sub("""The next boot waits for them to close before it builds.""", """The next boot waits for them to close before it builds, a failed boot's included.""")
sub("""A Re-baseline is both panes or neither. A span with a pane missing says `complete: false`.""",
    """A Re-baseline is both panes or neither. A span with a pane missing says `complete: false`.
- **J. A late baseline makes its spans unaligned, not re-settles the other pane.** Each pane's baseline and boot span name the run they came from. A span whose panes' windows differ says `aligned: false`, is incomplete, and judges its flags untrusted. The other pane isn't re-baselined at the late pane's snapshot, which would drop its changes since its ready read from both spans. A Re-baseline aligns the session span.
- **K. A span whose PR pane couldn't be read has a red `unreadable` flag** (`collection: null`), never no flags. PR code can make its own read fail.""")
sub("- **Tests:** 796 passed on Node 24 and on Node 22 (`npm test`). New here:\n  - `test/data-capture.test.mjs`: 11 tests;\n  - 11 server tests:",
    "- **Tests:** 820 passed on Node 24 and on Node 22 (`npm test`). New here:\n  - `test/data-capture.test.mjs`: 22 tests;\n  - 12 server tests:")
sub("a superseded boot's events, the wait for probes to close,", "a superseded boot's events, the wait for probes to close, a failed boot's included,")
sub("""and the version not bumped on a snapshot.""", """and the version not bumped on a snapshot. Round 3 added 20 more, all killed: windows that differ (trust, `complete`, the boot run, the session run), `unreadable`, one budget, whole field lists, whole flags, the counts, whole collections, the cut marker, an uncached failure, errors overwritten, a promise without an S0, a failed boot's close untracked, red first, and the changed collections first.""")
open(W + 'pr8c-body.md', 'w').write(s)
print('ok')
