R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
s = ''


def edit(path, pairs):
    global s
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:80])
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("- **Data** (`d`), with an [inspector](#data-checks), opens the data checks. Its badge counts the destructive changes the PR made and the base didn't.",
     "- **Data** (`d`), with an [inspector](#data-checks), opens the data checks. Its badge counts the red flags of both spans: in a trusted session the destructive changes the base didn't make too, in an advisory one every destructive change."),
    ("  - **Session** and **Boot** pick the span. **Divergence**, **Base** and **PR** pick what it shows: the panes side by side, or one pane's own changes. Click a collection for its rows.\n"
     "  - Values show as the data checks keep them: a secret only as `(secret)` or `(secret, changed)`, personal data as a fingerprint.",
     "  - **Session** and **Boot** pick the span. **Divergence**, **Base** and **PR** pick what it shows: the panes side by side, or one pane's own changes. Click a collection for its rows. A span a pane has no data for says it is incomplete, and why.\n"
     "  - It shows at most 300 collections and 100 flags, the red first, and 50 rows of each kind a collection, with how many more there are.\n"
     "  - Values show as the data checks keep them: a secret only as `(secret)` or `(secret, changed)`, in a row's key and inside JSON too, and personal data as a fingerprint. Names and values from the panes are set apart from the panel's own words, and a control or format character in them shows as its code (`\\u{202E}`), so none can reorder or break a line."),
    ("- **Actions** (`a`) opens the [action log](#security): each action the panes reported, newest last, with the requests it most likely set off. It reads on every two seconds while it is open, and starts over when the session is another.",
     "- **Actions** (`a`) opens the [action log](#security): each action the panes reported, newest last, with the requests it most likely set off, by the rule in [`GET /api/actions`](#http-api-harness-port). It reads on every two seconds while it is open and in view, and starts over when the session is another."),
    ("- **The harness runs only its own script.** Its policy also has `script-src 'self'; object-src 'none'; base-uri 'none'; frame-src <pane origins>`. Its Data and Actions panels show names, values and paths PR code controls, and draw them as text. If one ever slipped through as markup, it still couldn't run a script or frame another site. With a pane origin that is an IPv6 literal, which a CSP source can't express, `frame-src` is left out.",
     "- **The harness runs only its own script.** Its policy also has `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src <pane origins>`. Its Data and Actions panels show names, values and paths PR code controls, and draw them as text. If one ever slipped through as markup, it still couldn't run a script, load from or post to another site, or frame one. With a pane origin that is an IPv6 literal, which a CSP source can't express, `frame-src` is `http: https:`.\n"
     "  - **A pane can't leave its origin.** `frame-src` holds a pane's frame to its own origin, so a navigation to another one inside the pane (an SSO or OAuth hop, a hosted payment page, a redirect to another host) shows the browser's error page instead. Open the pane in a new tab (its bar's ↗) for such a flow."),
])

edit('CHANGELOG.md', [
    ("    - **Data** (`d`): the trust chip, Snapshot now and Re-baseline, both spans, divergence and each pane's changes, and a badge counting the PR-only destructive changes;\n"
     "    - **Actions** (`a`): each reported action with the requests it set off, read on from its cursor, and from 0 again for another session or a `resync`.\n"
     "\n"
     "    Both draw what PR code controls as text only.",
     "    - **Data** (`d`): the trust chip, Snapshot now and Re-baseline, both spans, divergence and each pane's changes, and a badge counting the red flags;\n"
     "    - **Actions** (`a`): each reported action with the requests it most likely set off, grouped by the documented rule, read on from its cursor while open and in view, and from 0 again for another session.\n"
     "\n"
     "    Both draw what PR code controls as text only, set apart, with its control characters shown as codes, and at most a few hundred items."),
    ("- **The harness's Content-Security-Policy is tighter:** `script-src 'self'; object-src 'none'; base-uri 'none'; frame-src <pane origins>`, beside `frame-ancestors 'self'`.\n"
     "  - **What breaks:** a harness page changed to load a script from elsewhere, or inline, no longer runs it. A test that compares the harness's `Content-Security-Policy` must expect the new one.",
     "- **The harness's Content-Security-Policy is tighter:** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src <pane origins>`, beside `frame-ancestors 'self'`. With a pane origin that can't be named (an IPv6 literal), `frame-src` is `http: https:`.\n"
     "  - **What breaks:**\n"
     "    - a harness page changed to load a script, or anything else, from elsewhere, or a script inline, no longer gets it;\n"
     "    - a pane's navigation to another origin inside its frame (an SSO or OAuth hop, a hosted payment page, a redirect to another host) shows the browser's error page: open the pane in a new tab for such a flow;\n"
     "    - a test that compares the harness's `Content-Security-Policy` must expect the new one."),
])
print('ok')
