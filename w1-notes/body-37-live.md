Fixes #8.

**Draft. Depends on #36; review only the commits after a2bbc7c** (#36's head): `a2bbc7c..fc2cc1a`, 3 commits, 10 files, +1,423 −26. The rest of the diff is #36, #35 and #34. This branch follows them by merging, never by rebasing.

**Round 2:** `16e03c1` fixes the review of `3e324d9`; the answer, item by item, is in the comments. It also carries #34's round-3 lows and nits, so #34 stays at its approved head: the raw-escape table rows, four separators between digits, `limit` 0 and −1, the precise README row for `GET /api/actions`, and the grouping tests, which live here with the harness that groups.

**Round 3:** `fc2cc1a` fixes round 2's review of `16e03c1`: a PR pane that couldn't be read shows as unknown changes (with #36's `unreadable` flag), Incomplete says why per pane, and separators are escaped; the answer, item by item, is in the comments.

This is the last of four PRs for #8's MVP (D = a), and the only one marked as completing the issue:
- **A, #34:** the action log and the harness's marks.
- **B, #35:** the data checks' pure engine.
- **C, #36:** the inspector seam, the baselines and the `/api/data` routes, and the demo inspector.
- **D, this PR:** the harness's Data and Actions panels, and the tighter harness CSP.

## Judgment calls (conservative defaults; say if you want another)

- **A. Pure functions build the panels as plain nodes, and the page draws them with `textContent` only.** `dataNodes` and `actionsNodes` return `{tag, cls, text, title, act, children}`, and a ten-line `buildNode` draws them.
  - Every tag, class and `act` is a fixed string. A collection is opened by its index, never by its name.
  - A test checks the panels' code has no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `src=` or `href=`.
  - Another runs the page against a stand-in browser and checks that a hostile collection name (`<img onerror>`) reaches the DOM only as `textContent`.
- **B. Values shown, masked per decision B:**
  - a secret shows as `(secret)`, or as `field: (secret, changed)` in an update, in a row's key too, and its digest never shows, nor one held inside text (`[secret]`);
  - personal data shows as `(personal data <fingerprint>, <type>, <length>)`.
  - Text from the panes is set apart (U+2068 … U+2069), with its control and format characters shown as codes (`\u{202E}`), so it can't reorder or break the panel's own words.
- **C. Trusted vs advisory follows the isolation verdict,** in a chip with its reason as the title. The badge counts every red flag, across both spans: red means the base didn't make the same change when trusted, and nothing is excused when advisory. A flag the base made too says so. A PR pane that couldn't be read is a red flag too, counted in the badge: its changes are unknown, never "No destructive change.". The badge reads the answer's `flagsCount`, so flags the answer leaves out still count. A span whose panes' windows differ says so, and nothing in it is excused.
- **D. The Actions panel polls `GET /api/actions` every 2 s, and only while it is open and the session view shows.**
  - Each read goes on from the cursor, at most 5 pages a tick.
  - A different `log`, or `active: false`, starts it over from 0.
  - It groups each request by README's rule (`markOf`), afresh each draw, since a mark can come after the requests it set off.
  - It keeps the newest 4,000 requests and 2,000 marks, and shows the newest 100 actions.
- **E. The Data panel isn't polled.** It is read when the session mounts (for the badge), when the panel opens, and from the answer to Snapshot now and Re-baseline. It draws at most 300 collections, 100 flags (the red first) and 50 rows a list, each with how many more, from #36's whole counts.
- **F. The CSP adds `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src <pane origins>`,** worked out per request from `cfg.paneOrigins`.
  - **`'unsafe-inline'` styles:** the page has an inline `<style>` and `style=` attributes. No inline script.
  - **`frame-src http: https:` when a pane origin can't be named** (an IPv6 literal, or a placeholder). Refusing the panes would be worse.
  - **A pane can't navigate to another origin in its frame** (an SSO or OAuth hop, a hosted payment page): the docs say to open it in a new tab.
- **G. Decision C:** the panels never touch the verdict drawer. A server test posts a verdict after a snapshot that flagged deletes, and checks the comment says nothing of them.
- **H. `d` and `a` toggle the panels, and `Esc` closes them.** The panes keep at least 30% of the height, and open panels share the rest.

## What changes

- **`public/harness.js`:**
  - the pure helpers `cellText`, `keyText`, `trustLabel`, `flagText`, `dataBadge`, `dataNodes`, `actionsFresh`, `mergeActions`, `markOf`, `actionsNodes` and `drawnText`, exported through the CommonJS guard for tests;
  - the panels' wiring: the Data button and badge, Snapshot now and Re-baseline, the span and view toggles, the Actions polling, and the keyboard.
- **`public/index.html`:** the two buttons, the two panels, their styles and the shortcut entries.
- **`lib/server.mjs`:** the harness's CSP.
- **`lib/action-log.mjs`:** four separators between digits (#34's round 3).
- **Docs:** the panels in Using the harness, the CSP in Security, the precise `GET /api/actions` row, and the CHANGELOG with what breaks: a test comparing the harness's CSP must expect the new one, and a pane can't navigate to another origin in its frame.

## Tests and review

- **Tests:** 850 passed on Node 24 and on Node 22 (`npm test`). New here:
  - the pure helpers, with hostile names and values;
  - masking in the panels;
  - the badge;
  - the badge through the real engine: a PR delete of other rows than the base's, or of more, trusted and advisory;
  - keys and nested secrets through the real engine;
  - controls and isolates in every drawn text;
  - the caps;
  - grouping by README's rule, at its edges and against the rule written plainly on random logs;
  - the Actions state across another log, no session, and the limits;
  - the page against a stand-in browser: the Data button shown only with an inspector, Snapshot now and Re-baseline posting, a failed read, answers for an ended session dropped, the Actions cursors as fetched, and polling stopping on close, Esc, the session's end and the verdict-done view;
  - the CSP, with an IPv6 pane origin and a placeholder;
  - the verdict saying nothing of the data checks.
- **Mutation:** 22 hand mutants, all caught. Among them:
  - drawing with `innerHTML`;
  - showing a secret's digest;
  - trusting by default;
  - ignoring a new `log` or a `resync`;
  - dropping `script-src` or `frame-src`.

  Round 2 added 52 more on its fixes and on #34's carried items, all killed: 50 at once, and two once tests were added (the panel closing when the session ends, and a snapshot's answer for an ended session). They cover the badge, keys and digests, isolation and escaping, the caps, every edge of `markOf`, polling and the session guards, each new CSP directive and its fallback, and the masker's raw-escape fallbacks. Round 3 added 19 more, all killed: the badge's `flagsCount`, the unreadable text and its fallback, separators, cut digests, the wording per pane, the unaligned line, each pane's baseline, the flag count, a flag's class, grouping's window and ties, four strings set apart, a failed read's guard, and polling once.
- **A real browser:** the demo on Chromium, through Playwright.
  - I booted fixture PR 106, added to the cart and emptied it in both panes through the mirror, then clicked Snapshot now.
  - The Data panel showed `advisory`, two red flags (`saved_carts: rows deleted, PR 3, base 0`, `emptied`), a badge of 2, and the PR pane's deleted carts with owners as fingerprints.
  - The Actions panel grouped both panes' requests under the base pane's clicks and submits.
  - Under the new CSP the panes loaded and the console showed no CSP error.
  - With both panels open, the panes first lost all their height. The panes now keep at least 30% of the height.
  - Round 2, with `default-src` and the reader's grouping: the same flow, a badge of 2, "Snapshot taken: 2 red flags", requests grouped under the PR pane's clicks and submits, and no `securitypolicyviolation`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MkcLhvB2oguJrgFNRVqAxy


