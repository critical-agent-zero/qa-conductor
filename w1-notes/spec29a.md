# #29 PR 1 — the per-browser capability (spec)

Base: main de9ec5d. Branch agent/w1-issue-29a. "Part of #29". Owner: A=a, B=a, C=a.

## Model

- **Store** (lib/capability.mjs, in memory, one per startConductor; a restart revokes all):
  - browser record = { harness token (header), pane token (cookie), lastUsed }. Lookup by sha256(token). At most 32 browsers; enrolling a 33rd drops the least recently used.
  - tickets: enter (60 s, single use, bound to a role and a `to` path) and invite (10 min, single use). At most 64 outstanding; expired pruned on mint.
  - tokens and tickets: 32 random bytes, base64url.
- **Harness**: every `/api/*` route except `POST /api/enrol` needs `X-QA-Cap: <harness token>`; `GET /api/progress` also takes `?cap=`. `/` and `/harness.js` stay open (static, no state).
- **Panes**: every request (bridge.js, /__qa/enter excepted) needs the pane cookie. Name `qa-<id>` (http) / `__Host-qa-<id>` (https pane origin), id = first 8 hex of sha256(harness origin). `HttpOnly; SameSite=Strict; Path=/` (+ `Secure` on https). Admitted if any cookie of that name is valid.
- **Refusal**: 403, `X-QA-Refusal: capability`, `cache-control: no-store`. Harness: JSON `{error}`; panes: text/plain + pane CSP.
- **Order**: identity gate → 421 → (harness) refused(): same-origin, harness host, 503 closing, 415 / (pane) paneRefusal → capability → routes / bridge → onActivity → forward.

## Routes

- `POST /api/enrol {}` → `{token}` while the window is open; `{invite}` → `{token}` any time with a live invite. Else 403 capability `{error, reason}`.
- `POST /api/invite {}` (cap) → `{url: <harnessOrigin>/qa/#enrol=<ticket>, expiresAt}`; 409 without a harness origin.
- `POST /api/pane-entry {role, to}` (cap) → `{url: <paneOrigin>/__qa/enter?t=<ticket>}`. `to`: resolved against the pane origin, must stay on it; stored as path+search+hash. 400 bad role/to; 409 when the pane origin isn't an origin yet, or its hostname isn't the harness origin's.
- `GET <pane>/__qa/enter?t=` → 303 Location `to`, Set-Cookie; no Referrer-Policy (the harness's holds for the next hop). Bad/used/expired/other-role ticket, or not GET → 403 capability.

## Enrolment window (server.mjs)

Open only when ALL hold: not closing; sweep settled and succeeded (or no sweep); status idle or error; no boot in flight (aborted ones included); no PR code since the last clean teardown (`cleanAt === ran`).
- `ran`: boots that reached bootSession and settled. A boot aborted before bootSession (sweep/cleanup wait) adds nothing.
- clean marks: (a) doTeardown ok, no boot in flight at its start or end, `ran` unchanged; (b) a failed boot whose own teardown succeeded (teardownSession now returns ok), with no other boot in flight at its start and none settled during it.
- post-settle cleanup: when the last boot in flight settles (or a doTeardown ends) with the session idle/error, not closing, and dirty → teardownSession; ok → clean. startBoot waits for it as for the sweep. Logs on failure.
- failed sweep → closed until restart (log says so).

## Startup checks (startConductor)

- forwardClientCookies with a reserved name (`qa-…`, `__Host-qa-…`, `__Secure-qa-…`, any case) throws; also loadConfig (QA_FORWARD_CLIENT_COOKIES) and createPaneProxy.
- layout: harness origin known at start and a pane origin set at start (not the equal placeholders) on another hostname → throws. Checked again at pane-entry (409).
- runs after the existing checks, before the sweep.

## Proxy

- `createPaneProxy({ capability })`: optional `{ cookieName(), secure(), admits(value), enter(ticket) → {to, token}|null }`. Without it, unchanged.
- drops `Clear-Site-Data` from app responses. Never forwards a reserved cookie name upstream.

## Harness UI

- token in localStorage `qa-cap` (try/catch; memory fallback). Auto-enrol on load when no token; invite from `#enrol=` (replaceState first).
- capability 403 on any call → drop token, try enrol once, else the enrol view (reason + how to get in + Try again).
- SSE `?cap=`; onerror CLOSED → re-render.
- panes via `enterPane(role, to)`: landing URL, reload (current path), re-sync. Errors on the pane bar.
- header **Invite** → dialog with the link, Copy, "single use, 10 minutes".

## Seam for tests

`startConductor({ capability })`: a store from createCapability(); default a fresh one.

## Tests (§5)

- PR code on loopback: raw client (loopback Host, forged allowed login, Sec-Fetch-Site same-origin, Origin = harness origin) on every API route (+/qa prefix, OPTIONS, HEAD, unknown), SSE (none, wrong ?cap), both proxies (GET/POST, bridge.js, /__qa/enter with no/garbage ticket), /api/enrol while running → 403 capability; upstream sees nothing, no comment, activity unchanged. none + tailscale.
- window: refused booting, ready, tearing-down, aborted boot unsettled, failed sweep, failed teardown; reopens after a clean teardown / cleanup.
- browser flow: enrol → session → pane-entry → enter 303 + Set-Cookie (http and https forms) → forwarded, no qa- upstream; reuse, other role, expiry refused; invite flow; restart revokes.
- startup throws: reserved cookie names (startConductor, loadConfig, createPaneProxy), cross-host layout; equal placeholders start.
- unit: capability store, cookie names/parsing.

## Docs

README: Using the harness (enrol, invites), Security (new bullet; loopback/none-mode text; one hostname), HTTP API, Configuration (reserved names), A cfg built in code, Known limits (plain-http cookie gap, install scripts / no sweep, base app port, nested tailnet self-QA), Demo. SECURITY.md scope. CONTRIBUTING (nested tailnet). CHANGELOG [Unreleased] at the end of the section (avoid #28's insertion point): what breaks (first visit enrols; a running session needs an invite; one hostname; qa- names), demo and npm run qa.
