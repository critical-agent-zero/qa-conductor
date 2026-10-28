**Draft. Depends on #35; review only the commits after 2ec0bba** (#35's head): `2ec0bba..a2bbc7c`, 5 commits, 13 files, +1,547 −45. The rest of the diff is #35 and #34. This branch follows them by merging, never by rebasing.

**Round 2:** `31056d0` fixes the review of `0991ab1`. **Round 3:** `a2bbc7c` fixes round 2's review of `31056d0`, and #37's round-2 high (the `unreadable` flag). The answers, item by item, are in the comments.

Part of #8. This is the third of four PRs for #8's MVP (D = a):
- **A, #34:** the action log and the harness's marks.
- **B, #35:** the data checks' pure engine.
- **C, this PR:** the read-only `adapters.inspector` seam, the seeded and ready baselines with "Snapshot now" and "Re-baseline", the `/api/data` routes, and the demo inspector.
- **D:** the harness's Data and Actions panels and the tighter CSP. Only D is marked as completing issue 8.

So far nothing in the harness shows the data. PR D adds the Data panel.

## Judgment calls (conservative defaults; say if you want another)

- **A. The conductor makes the capture, and `bootSession` takes it as `deps.capture`.** The design had `bootSession` return the probes. This way `bootSession`'s result is unchanged, the server owns each session's probes, and the inspector never sees the conductor.
- **B. S0 is per pane, right after that pane's `seedPane`,** before its `reserveServices`. The base pane's S0 is taken before the PR pane is seeded. Nothing of the PR's has run on either pane yet.
- **C. A failing inspector never fails the boot.** Each `open`, `snapshot` and `close` is bounded:
  - `open` and `snapshot` by `limits.timeoutMs` (30 s);
  - `close` by 5 s, since it holds up a teardown.

  Each call also gets a signal that aborts at its timeout, so a call that heeds it stops. A hanging inspector can add up to 150 s to a boot: an open and a seeded read per pane, one after the other, then the ready reads together. The budget is per call, not per boot.
- **D. Errors from the inspector are shown to the harness as they come.** A database error may quote a value. They go only to `GET /api/data`, never the event stream or a log. They are kept per span: `errors.boot` (the open, seeded and ready reads, each reason kept, never erased by a later success) and `errors.session` (the latest read).
- **E. `GET /api/data` lists in part, and isn't paged. An answer is about 6 MB at most.**
  - A diff lists at most 1,000 collections, the changed first, and 50 rows, changes and dropped and added fields of each kind a collection. A span lists at most 500 flags, red first. All of those lists share 2 MB a span, and a collection the budget cut says `cut`. Whole counts sit beside every list (`counts`, `changesCount`, `collectionsCount`, `flagsCount`).
  - The JSON is built once per state and trust, and every reader gets that string. One that fails to build fails again at once until the state changes.
  - Measured: round 1's case (4 tables of 10,000 rows, rewritten twice) gives 292 KB; round 2's (100 tables of 1,600 columns, added then dropped) 2.1 MB in 0.6 s; 1,000 collections of 20 wide rows rewritten twice, 5.6 MB in 0.56 s.
  - Paging the rest is left for later.
- **F. Snapshot now and Re-baseline count as activity; reading doesn't.**
  - Concurrent calls of one kind share one snapshot.
  - One of the other kind meanwhile answers `409`.
  - One running when the session ends answers `409`, at once.
- **G. Probes close at the next boot, at teardown before `teardownSession`, and when a boot is superseded or fails.** The in-flight boot's probes close at teardown too. The next boot waits for them to close before it builds, a failed boot's included.
- **I. A pane whose ready read failed keeps its S0,** and its first later snapshot is its baseline, so the PR's boot changes still show. A failed Snapshot now leaves its pane with no session span rather than a stale one. A Re-baseline is both panes or neither. A span with a pane missing says `complete: false`.
- **J. A late baseline makes its spans unaligned, not re-settles the other pane.** Each pane's baseline and boot span name the run they came from. A span whose panes' windows differ says `aligned: false`, is incomplete, and judges its flags untrusted. The other pane isn't re-baselined at the late pane's snapshot, which would drop its changes since its ready read from both spans. A Re-baseline aligns the session span.
- **K. A span whose PR pane couldn't be read has a red `unreadable` flag** (`collection: null`), never no flags. PR code can make its own read fail.
- **H. The demo's panes share one host** (`isolation: 'shared-host'`), so its comparison is always advisory and every flag is red. Divergence still says which change was the PR's alone. Its new fixture PR 106 shows that: its *Empty cart* also deletes the saved carts.

## What changes

- **`lib/data-capture.mjs` (internal):** one capture per boot.
  - It holds the probes, `seeded`, the baseline and the latest snapshot per pane.
  - `view({isolation})` gives the boot span (`seeded` to `ready`) and the session span (baseline to now). Each has the panes' diffs, their divergence and the PR's flags, trusted only when the session is isolated.
  - S0 goes once its pane has a baseline.
- **`bootSession`** takes `deps.capture`: `seeded` after each `seedPane`, with its `db`, and `ready` after the sign-ins. Neither can fail the boot, and an aborted boot calls neither.
- **The conductor:**
  - `adapters.inspector` is checked at start: it needs `open()`, and its `rules` must pass `validateRules`;
  - `GET /api/data` and `POST /api/data/snapshot {rebaseline?}`, behind the capability, `no-store`;
  - `/api/state` has `data: {available}`;
  - the event stream gets `{kind: 'capture', pane, phase, ok}` for the `seeded` and `ready` phases only.
- **The demo:**
  - the pane app's cart and messages move into a store made with each pane's database, which the Seed fills with three saved carts;
  - an inspector reads that store, with names, emails and owners as personal data;
  - fixture PR 106 empties the saved carts with the cart.
- **Docs:** the Inspector in The seams (its row and contract), how the data checks take their snapshots, the two API rows, the demo, and the CHANGELOG with what breaks.

## Where values could leak

- **They reach only `GET /api/data` and the snapshot route's answer,** behind the capability, `no-store`. That is masked: secrets as digests, personal data as fingerprints (#35).
- **The event stream and the logs:** a test puts emails and tokens in both panes' data, then checks they aren't in the event stream, `/api/state` or any line the conductor logged.
- **GitHub:** nothing goes there (C = c). `verdict.mjs` and `github.mjs` are untouched.

## Tests and review

- **Tests:** 820 passed on Node 24 and on Node 22 (`npm test`). New here:
  - `test/data-capture.test.mjs`: 22 tests;
  - 12 server tests: no inspector, the spans and masking, trusted vs advisory, the lifecycle and races, superseded and failed boots, a superseded boot's events, the wait for probes to close, a failed boot's included, the route checks, start-time checks;
  - 1 session test;
  - the demo's end-to-end test for fixture PR 106.
- **Mutation:** 35 hand mutants. 27 died at once, and 6 more died once tests were added:
  - S0 let go;
  - flags with no base pane;
  - close dropping a snapshot at once;
  - no baseline after an aborted `ready`;
  - an abort right after a seed or a sign-in;
  - probes closing as a new boot starts;
  - the snapshot answer's trust.

  Round 2 added 14 more on the review's fixes, all killed: the timeout signal, S0 dropped, no late baseline, a stale latest kept, a partial re-baseline, the boot error erased, `complete` always true, no listing cap, no cache, a cache that ignores trust, `now` events, superseded events, closing not awaited, and the version not bumped on a snapshot. Round 3 added 20 more, all killed: windows that differ (trust, `complete`, the boot run, the session run), `unreadable`, one budget, whole field lists, whole flags, the counts, whole collections, the cut marker, an uncached failure, errors overwritten, a promise without an S0, a failed boot's close untracked, red first, and the changed collections first.

  Two survive as equivalent:
  - a second `close()` closing nothing more, because the probes are already gone;
  - the route's own "the session ended" check, which the capture's makes redundant. I kept it as a guard.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MkcLhvB2oguJrgFNRVqAxy


