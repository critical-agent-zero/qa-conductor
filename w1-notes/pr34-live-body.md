Part of #8. With #31 merged, this PR's diff against `main` is its own: 10 files, +1,167 −8. `main` (24d048b) is merged in, not rebased onto.

This is the first of four PRs for #8's MVP (D = a). The PR that was planned as B is split in two to stay under about 1,500 lines a PR:
- **A, this PR:** the action log and the harness's marks.
- **B:** the data checks' pure engine, exported as `./data-diff`: masking, per-pane diffs, divergence, destructive flags, and trusted vs advisory.
- **C:** the read-only `adapters.inspector` seam, the seeded and ready baselines with "Snapshot now" and "Re-baseline", the `/api/data` routes, and the demo inspector.
- **D:** the harness's Data and Actions panels and the tighter CSP.

So far nothing in the harness shows the log. PR D adds the Actions panel.

## Judgment calls (conservative defaults; say if you want another)

- **A. Masking is a heuristic.** A path keeps its shape, and a segment that looks like a value shows only its kind:
  - `:email` for anything with an `@`, fullwidth `＠` or small `﹫`;
  - `key=…` for a `key=value` segment;
  - `:number` for seven digits or more anywhere in the segment, with at most three separators between two (a phone, a card, `ACCT9876543210`);
  - `:token` for a JWT, hex of 16 or more, a long mix of letters and digits, or a run of 24 letters or more.

  A segment is decoded up to three times first, so a value encoded twice is still seen. A query keeps only its keys, and a query part with no `=` goes whole. Short codes (six digits or fewer) and tokens under 16 characters can slip through. The README says so. The stricter option is to drop every path past its first segment, which would lose most of what the log is for.
- **B. Marks come from the pane's bridge, which PR code can drive.** A mark keeps only the pane and the kind (`click`, `submit`, `change`, `enter`), and says which pane reported it. Each mark, mirrored or not:
  - is limited to one of each kind per pane every 100 ms, so a click and the submit it sets off are both kept;
  - comes from a budget of 2,000 per pane that refills one a second, so the PR pane can use up its own marks for as long as it keeps posting, never the base pane's. Each pane keeps its last 8,000 marks;
  - when refused, is counted per pane in `marksDropped`.
- **C. Grouping is the reader's.** A read gives requests and marks together, in the one sequence they were recorded in, at most `limit` at a time. A reader that reads on until `more` is false has had everything, once. Which action a request came from is worked out by the reader, by the rule README states:
  - the request's own pane's nearest mark within 300 ms either side;
  - else the nearest of the marks up to 300 ms after it started, the earlier on a tie;
  - else the landing.

  A mark can come after the requests it set off, so the reader groups again as marks come. Every read names its `log`, so a reader sees when the session under its cursor changed.
- **D. A request a guard refuses is only counted, by reason, never logged as an entry.** Another site's page can't write entries.
- **E. No activity.** Reading the log and posting a mark don't count as session activity. An open view must not keep a session alive, and PR code can post bridge messages.
- **F. `cache-control: no-store` is only on the two action routes,** not on every API answer, to keep this diff small.
- **G. Requests the proxy never forwards aren't logged:** the bridge, `/__qa/enter`, and the 503 with no session.

## What changes

- **`lib/action-log.mjs` (internal):**
  - `sanitizePath` and `sanitizeMethod`;
  - `createActionLog`, which records value-free entries and marks.
  - Each entry has `seq`, `pane`, `at`, `method`, `path`, `status`, `ms`, `bytes` and `aborted`.
  - Each pane keeps a ring of its last 5,000 entries and counts the ones it dropped.
  - Reads give requests and marks in one sequence, at most 2,000 at a time, with `more`, a `seq` cursor and the log's id.
  - Requests and marks are stamped with one monotonic clock.
- **The pane proxy (`createPaneProxy`)** takes two new hooks:
  - `recorder`: bound when a request starts and called once when the exchange closes. It records the status (`0` when the client went before an answer), the time, the bytes sent back and whether the exchange was aborted.
  - `onRefused(reason)`: called for the cross-site, misdirected and capability refusals.
- **The conductor:**
  - It keeps one log per session, in memory: made at ready, dropped at the next boot and at teardown, as the cookie jars are.
  - A request lands in the log of the session it started in.
  - Routes:
    - `GET /api/actions?after=N&limit=M`
    - `POST /api/actions/mark {pane, type}`: a JSON route that answers `400` for a bad pane or kind and `409` with no session ready.
- **The harness** posts a mark for each click, submit, change and Enter a pane's bridge reports, with the same per-pane, per-kind throttle.
- **Docs:** a Security bullet in the README ("The action log keeps no values"), two HTTP API rows, and a CHANGELOG section under `## [Unreleased]`.

## Where values could leak

- Nothing of the log reaches the event stream, the conductor's log or GitHub (C = c). The routes sit behind the capability like the rest of the API.
- An entry never holds a header, a cookie, a body or a query value.
- A mark never holds the element, the text or what was typed.

## Tests and review

- **Tests:** 741 passed on Node 24 and on Node 22 (`npm test`). They cover masking, paging, grouping and its edges, per-pane caps, and the recorder's binding across a boot of the same PR. They also cover the proxy's byte count, status `0` on an abort, `at` taken at the start, and the harness's per-kind marks.
- **Self-review:** a review of the first two commits found 7 items, F1 to F7, plus some test gaps:
  - stale groupings when reading after a cursor;
  - a throttle that dropped a submit right after its click;
  - a mark cap the PR pane could use up;
  - masking bypasses;
  - grouping to the later mark instead of the nearest;
  - unbounded reads;
  - docs.

  All are fixed test-first in `ef0dfeb`. A second pass found that a page could name a mark it doesn't give, fixed in `950473b`.
- **Mutation:** 20 hand mutants of the fixes. 17 died at once. Three new tests killed the other three: a tie between two marks, the regroup window's edge, and marks held in time order when the clock steps back.
- **The orchestrator's review** (REQUEST_CHANGES, all low) is answered in `0354973`, item by item in a comment. 29 hand mutants of that round's changes: 23 died at once, and new tests killed the other 6.
- **Round 2** (three medium findings, and lows) is answered in `07098b8`, with 10 hand mutants of its changes, all killed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MkcLhvB2oguJrgFNRVqAxy

