**Draft. Depends on #35; review only the commits after 5cf2b16** (#35's head): `5cf2b16..0991ab1`, 3 commits, 13 files, +1,024 −44. The rest of the diff is #35 and #34. This branch follows them by merging, never by rebasing.

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

  So a hanging inspector can add up to 30 s per step to a boot.
- **D. Errors from the inspector are shown to the harness as they come.** A database error may quote a value. They go only to `GET /api/data`, never the event stream or a log.
- **E. `GET /api/data` isn't paged.** It holds both spans' diffs, so a mass delete of 10,000 rows sends those rows. It is bounded by the snapshots' 32 MB a pane. PR D can ask for less if the panel needs it.
- **F. Snapshot now and Re-baseline count as activity; reading doesn't.**
  - Concurrent calls of one kind share one snapshot.
  - One of the other kind meanwhile answers `409`.
  - One running when the session ends answers `409`, at once.
- **G. Probes close at the next boot, at teardown before `teardownSession`, and when a boot is superseded or fails.** The in-flight boot's probes close at teardown too.
- **H. The demo's panes share one host** (`isolation: 'shared-host'`), so its comparison is always advisory and every flag is red. Divergence still says which change was the PR's alone. Its new fixture PR 106 shows that: its *Empty cart* also deletes the saved carts.

## What changes

- **`lib/data-capture.mjs` (internal):** one capture per boot.
  - It holds the probes, `seeded`, the baseline and the latest snapshot per pane.
  - `view({isolation})` gives the boot span (`seeded` to `ready`) and the session span (baseline to now). Each has the panes' diffs, their divergence and the PR's flags, trusted only when the session is isolated.
  - S0 goes once the boot span is known.
- **`bootSession`** takes `deps.capture`: `seeded` after each `seedPane`, with its `db`, and `ready` after the sign-ins. Neither can fail the boot, and an aborted boot calls neither.
- **The conductor:**
  - `adapters.inspector` is checked at start: it needs `open()`, and its `rules` must pass `validateRules`;
  - `GET /api/data` and `POST /api/data/snapshot {rebaseline?}`, behind the capability, `no-store`;
  - `/api/state` has `data: {available}`;
  - the event stream gets `{kind: 'capture', pane, phase, ok}`.
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

- **Tests:** 789 passed on Node 24 and on Node 22 (`npm test`). New here:
  - `test/data-capture.test.mjs`: 10 tests;
  - 9 server tests: no inspector, the spans and masking, trusted vs advisory, the lifecycle and races, superseded and failed boots, the route checks, start-time checks;
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

  Two survive as equivalent:
  - a second `close()` closing nothing more, because the probes are already gone;
  - the route's own "the session ended" check, which the capture's makes redundant. I kept it as a guard.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MkcLhvB2oguJrgFNRVqAxy

