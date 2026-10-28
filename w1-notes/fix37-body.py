p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/pr8d-body.md'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b, 1)


sub("""**Draft. Depends on #36; review only the commits after 0991ab1** (#36's head): `0991ab1..3e324d9`, 1 commit, 8 files, +719 −13. The rest of the diff is #36, #35 and #34. This branch follows them by merging, never by rebasing.""",
    """**Draft. Depends on #36; review only the commits after 31056d0** (#36's head): `31056d0..16e03c1`, 2 commits, 10 files, +1,244 −26. The rest of the diff is #36, #35 and #34. This branch follows them by merging, never by rebasing.

**Round 2:** `16e03c1` fixes the review of `3e324d9`; the answer, item by item, is in the comments. It also carries #34's round-3 lows and nits, so #34 stays at its approved head: the raw-escape table rows, four separators between digits, `limit` 0 and −1, the precise README row for `GET /api/actions`, and the grouping tests, which live here with the harness that groups.""")
sub("""- **B. Values shown, masked per decision B:**
  - a secret shows as `(secret)`, or as `field: (secret, changed)` in an update, and its digest never shows;
  - personal data shows as `(personal data <fingerprint>, <type>, <length>)`.""",
    """- **B. Values shown, masked per decision B:**
  - a secret shows as `(secret)`, or as `field: (secret, changed)` in an update, in a row's key too, and its digest never shows, nor one held inside text (`[secret]`);
  - personal data shows as `(personal data <fingerprint>, <type>, <length>)`.
  - Text from the panes is set apart (U+2068 … U+2069), with its control and format characters shown as codes (`\\u{202E}`), so it can't reorder or break the panel's own words.""")
sub("""- **C. Trusted vs advisory follows the isolation verdict,** in a chip with its reason as the title. The badge counts the red flags the base didn't share (`base: 0`), across both spans.""",
    """- **C. Trusted vs advisory follows the isolation verdict,** in a chip with its reason as the title. The badge counts every red flag, across both spans: red means the base didn't make the same change when trusted, and nothing is excused when advisory. A flag the base made too says so.""")
sub("""- **D. The Actions panel polls `GET /api/actions` every 2 s, and only while it is open.**
  - Each read goes on from the cursor, at most 5 pages a tick.
  - A different `log`, a `resync`, or `active: false` starts it over from 0 at once.
  - It keeps the newest 4,000 requests and 2,000 marks, and shows the newest 100 actions.""",
    """- **D. The Actions panel polls `GET /api/actions` every 2 s, and only while it is open and the session view shows.**
  - Each read goes on from the cursor, at most 5 pages a tick.
  - A different `log`, or `active: false`, starts it over from 0.
  - It groups each request by README's rule (`markOf`), afresh each draw, since a mark can come after the requests it set off.
  - It keeps the newest 4,000 requests and 2,000 marks, and shows the newest 100 actions.""")
sub("""- **E. The Data panel isn't polled.** It is read when the session mounts (for the badge), when the panel opens, and from the answer to Snapshot now and Re-baseline. A list shows at most 50 rows, then says how many more.""",
    """- **E. The Data panel isn't polled.** It is read when the session mounts (for the badge), when the panel opens, and from the answer to Snapshot now and Re-baseline. It draws at most 300 collections, 100 flags (the red first) and 50 rows a list, each with how many more, from #36's whole counts.""")
sub("""- **F. The CSP adds `script-src 'self'; object-src 'none'; base-uri 'none'; frame-src <pane origins>`,** worked out per request from `cfg.paneOrigins`.
  - **No `default-src` and no `style-src`:** the page has an inline `<style>` and `style=` attributes. That leaves inline styles possible, but no inline script.
  - **No `frame-src` when a pane origin is an IPv6 literal,** which a CSP source can't express (a known limit already). Refusing the panes would be worse.""",
    """- **F. The CSP adds `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src <pane origins>`,** worked out per request from `cfg.paneOrigins`.
  - **`'unsafe-inline'` styles:** the page has an inline `<style>` and `style=` attributes. No inline script.
  - **`frame-src http: https:` when a pane origin can't be named** (an IPv6 literal, or a placeholder). Refusing the panes would be worse.
  - **A pane can't navigate to another origin in its frame** (an SSO or OAuth hop, a hosted payment page): the docs say to open it in a new tab.""")
sub("""- **`public/harness.js`:**
  - the pure helpers `cellText`, `trustLabel`, `flagText`, `dataBadge`, `dataNodes`, `actionsFresh`, `mergeActions` and `actionsNodes`, exported through the CommonJS guard for tests;""",
    """- **`public/harness.js`:**
  - the pure helpers `cellText`, `keyText`, `trustLabel`, `flagText`, `dataBadge`, `dataNodes`, `actionsFresh`, `mergeActions`, `markOf`, `actionsNodes` and `drawnText`, exported through the CommonJS guard for tests;""")
sub("""- **Docs:** the panels in Using the harness, the CSP in Security, and the CHANGELOG with what breaks: a test comparing the harness's CSP must expect the new one.""",
    """- **`lib/action-log.mjs`:** four separators between digits (#34's round 3).
- **Docs:** the panels in Using the harness, the CSP in Security, the precise `GET /api/actions` row, and the CHANGELOG with what breaks: a test comparing the harness's CSP must expect the new one, and a pane can't navigate to another origin in its frame.""")
sub("""- **Tests:** 800 passed on Node 24 and on Node 22 (`npm test`), 11 of them new here:""",
    """- **Tests:** 817 passed on Node 24 and on Node 22 (`npm test`). New here:""")
sub("""  - the Actions state across another log, `resync` and the limits;
  - the page against a stand-in browser: the Data button shown only with an inspector, Snapshot now and Re-baseline posting, and the Actions cursors as fetched (`after=0`, `after=2`, then `after=0` again for another log, and again for a `resync`);
  - the CSP, with and without an IPv6 pane origin;""",
    """  - the badge through the real engine: a PR delete of other rows than the base's, or of more, trusted and advisory;
  - keys and nested secrets through the real engine;
  - controls and isolates in every drawn text;
  - the caps;
  - grouping by README's rule, at its edges and against the rule written plainly on random logs;
  - the Actions state across another log, no session, and the limits;
  - the page against a stand-in browser: the Data button shown only with an inspector, Snapshot now and Re-baseline posting, a failed read, answers for an ended session dropped, the Actions cursors as fetched, and polling stopping on close, Esc, the session's end and the verdict-done view;
  - the CSP, with an IPv6 pane origin and a placeholder;""")
sub("""  - dropping `script-src` or `frame-src`.""",
    """  - dropping `script-src` or `frame-src`.

  Round 2 added 52 more on its fixes and on #34's carried items, all killed: 50 at once, and two once tests were added (the panel closing when the session ends, and a snapshot's answer for an ended session). They cover the badge, keys and digests, isolation and escaping, the caps, every edge of `markOf`, polling and the session guards, each new CSP directive and its fallback, and the masker's raw-escape fallbacks.""")
sub("""  - The Actions panel grouped both panes' requests under the base pane's clicks and submits.
  - Under the new CSP the panes loaded and the console showed no CSP error.
  - With both panels open, the panes first lost all their height. The panes now keep at least 30% of the height.""",
    """  - The Actions panel grouped both panes' requests under the base pane's clicks and submits.
  - Under the new CSP the panes loaded and the console showed no CSP error.
  - With both panels open, the panes first lost all their height. The panes now keep at least 30% of the height.
  - Round 2, with `default-src` and the reader's grouping: the same flow, a badge of 2, "Snapshot taken: 2 red flags", requests grouped under the PR pane's clicks and submits, and no `securitypolicyviolation`.""")
open(p, 'w').write(s)
print('ok')
