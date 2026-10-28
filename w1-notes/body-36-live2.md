**Draft. Depends on #35; review only what is past #35's head, `4a284f9`** (which carries `main` at `561bd84`): `4a284f9..2b8379d`. This branch follows #35 by merging, never by rebasing.

**Round 2:** `31056d0` fixes the review of `0991ab1`. **Round 3:** `a2bbc7c` fixes round 2's review of `31056d0`, and #37's round-2 high (the `unreadable` flag). **Round 4:** `7055c24` fixes round 3's review of `a2bbc7c` (comment 6198758962). **Round 5:** `2b8379d` answers round 4's review of `7055c24` (comment 6341158113), under the owner's decision W28=B. The answers, item by item, are in the comments, the last in comment 6346159242.

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
- **E. `GET /api/data` lists in part, and isn't paged. An answer is about 4 MB at most.**
  - **Collections:** a diff lists at most 1,000 collections, ranked:
    1. those with a red flag, in the order of their first flag in the engine's order. So the base pane's collections come before the PR's own, and what lost data comes before column and mass-change flags (round 5);
    2. changed rows;
    3. an amber flag;
    4. any other change.

    Each has 50 rows, changes and dropped and added fields of each kind.
  - **Flags:** a span lists at most 500, red first in the engine's order. Red `unverified` flags past 20 are one flag in their place.
  - **Problems and errors:** 50 problems a pane, and an error's text is cut at 500 characters.
  - **The budget:** all of those lists, and each collection's own entry (name, key, counts), share 2 MB a span, counted in bytes as UTF-8. The flags go first. Then the PR pane's diff, the divergence and the base pane's diff are listed by rank across all three: every list's red-flagged collections, then every list's changed ones, and so on (round 5). A collection the budget cut says `cut`, and so does a diff whose listing it stopped. Whole counts sit beside every list (`counts`, `changesCount`, `collectionsCount`, `flagsCount`, `problemsCount`).
  - **The JSON is built once per state and trust,** and every reader gets that string. One too big to build is built again without its lists, keeping its counts and first red flags behind a red `unlisted` flag. One that still fails fails again at once until the state changes.
  - **Judgment call, round 4:** the flags keep the engine's order, the base pane's collections first and destructive kinds before `unverified`, rather than every non-`unverified` red flag first. Since round 5 the collections follow it too, and within the base pane's collections what loses data comes before column and mass-change flags (#35). A PR that drops its padding raises thousands of red `dropped` flags on collections only it has, and those must not bury a seeded collection's `unverified`.
  - Measured: round 1's case (4 tables of 10,000 rows, rewritten twice) gives 292 KB; round 2's (100 tables of 1,600 columns, added then dropped) 2.1 MB in 0.6 s; 1,000 collections of 20 wide rows rewritten twice, 5.6 MB in 0.56 s before round 4, and 3.99 MB in 0.47 s now that each entry is charged.
  - Paging the rest is left for later.
  - **Its time isn't bounded** (owner decision W28=B, round 5). The engine runs on the conductor's event loop: `take()` masks a snapshot, `settle()` diffs one, and each answer's build diffs both panes' session snapshots, flags them and lists them, once per state and trust.
    - **The worst cases round 4's review measured** within the default limits (10,000 rows, 32 MB), as the event loop's longest hold:

      | Probe | Ready | Snapshot now | Answer build |
      |---|---|---|---|
      | 200 PR tables of 10,000 rows | 18.2 s | 6.9 s | 7–9 s |
      | 4 seeded tables × 96 fields, rewritten | 10.3 s | 7.0 s | 8.0 s |
      | one 10,000-row table with 100 fields cleared | | | 22.3 s; now about 0.4 s, since #35's `tally()` is linear |

    - Masking can be slower still in the worst shapes: #35's review measured about 4 minutes for a 32 MB snapshot of lines that look like JSON.
    - **This is accepted:** the PR's authors passed the trust gate, it needs the harness capability, and it shows no masked value and hides or excuses no destructive change. It only slows that PR's review.
    - The README says so in the `GET /api/data` row and under Known limits ("Hostile PR data and the conductor's responsiveness").
    - Moving the engine to a worker thread, or yielding between collections, is the fuller fix, and is left for a follow-up.
- **F. Snapshot now and Re-baseline count as activity; reading doesn't.**
  - Concurrent calls of one kind share one snapshot.
  - One of the other kind meanwhile answers `409`.
  - One running when the session ends answers `409`, at once.
- **G. Probes close at the next boot, at teardown before `teardownSession`, and when a boot is superseded or fails.** The in-flight boot's probes close at teardown too. The next boot waits for them to close before it builds, a failed boot's included.
- **I. A pane whose ready read failed keeps its S0,** and its first later snapshot is its baseline, so the PR's boot changes still show. A failed Snapshot now leaves its pane with no session span rather than a stale one. A Re-baseline is both panes or neither. A span with a pane missing says `complete: false`.
- **J. A late baseline makes its spans unaligned, not re-settles the other pane.** Each pane's baseline and boot span name the run they came from. A span whose panes' windows differ says `aligned: false`, is incomplete, and judges its flags untrusted. The other pane isn't re-baselined at the late pane's snapshot, which would drop its changes since its ready read from both spans: when that pane is the PR's, its own changes would show nowhere. So the span stays unaligned and untrusted until a Re-baseline aligns the session span; nothing is hidden, and nothing is excused meanwhile.
- **K. A span whose PR pane couldn't be read has a red `unreadable` flag** (`collection: null`), never no flags. PR code can make its own read fail. So does a span neither pane could be read for once a run has happened, and one whose PR baseline just came late. Its `reason` says which: `failed`, `neither` or `baseline`.
- **L. A boot span is aligned only when both panes' baselines came from the ready read itself** (round 4). When both ready reads fail, both boot spans run on into the session, so they are unaligned, and untrusted. `baselineAt` is set only when a pane settled at ready.
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

- **Tests:** 883 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). New here:
  - `test/data-capture.test.mjs`: 40 tests;
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

  Round 2 added 14 more on the review's fixes, all killed: the timeout signal, S0 dropped, no late baseline, a stale latest kept, a partial re-baseline, the boot error erased, `complete` always true, no listing cap, no cache, a cache that ignores trust, `now` events, superseded events, closing not awaited, and the version not bumped on a snapshot. Round 3 added 20 more, all killed: windows that differ (trust, `complete`, the boot run, the session run), `unreadable`, one budget, whole field lists, whole flags, the counts, whole collections, the cut marker, an uncached failure, errors overwritten, a promise without an S0, a failed boot's close untracked, red first, and the changed collections first. Round 4 added 29 more, all killed after two more tests: the entry charge, the stop, the fallback, the error and problems cuts, the ranking, the fold, the order of a span's lists, the boot alignment, `baselineAt`, the non-null span, each `reason`, the late-baseline wording, the divergence's cut and count, and the budget's halves. Round 5 added 12 more on the ranking by flag order, the tiers across lists, the cut marker, the byte count and the reason, all killed, and assertions for the 11 round 4 found alive.

  Two survive as equivalent:
  - a second `close()` closing nothing more, because the probes are already gone;
  - the route's own "the session ended" check, which the capture's makes redundant. I kept it as a guard.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MkcLhvB2oguJrgFNRVqAxy


