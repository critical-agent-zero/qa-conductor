# #8 MVP spec (w1), on #31 head b7400dc

Binding: owner A=b (seeded+ready), B=a (values shown, secret-like/classify masked, pii fingerprinted),
C=c (never anything to GitHub), D=a (MVP scope), G=a (key fields + data rules), #29: trusted only when
isolation verdict is `isolated`, else advisory (base changes never excuse a PR change); process Provisioner
always advisory (shared-host). Egress/change feeds: NOT in MVP.

## PR A — agent/w1-issue-8a (base b7400dc): inbound action log + marks ("Part of #8")

lib/action-log.mjs (pure, internal):
- `sanitizePath(url)`: path + query -> display string. Query: `?k=…` per key; key kept only if
  /^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/, else `…`. Path segments: email-like (contains @ after decoding) -> `:email`;
  token-like (decoded length >= 16 with a letter and a digit, or hex >= 16, or JWT-like a.b.c) -> `:token`;
  digits-only length >= 9 -> `:number`. Fragment dropped. Result capped at 200 chars (`…`).
- `sanitizeMethod(m)`: /^[A-Z]{1,12}$/ else 'OTHER'.
- `createActionLog({ now, maxEntries = 5000, maxMarks = 2000, markGapMs = 100 })`:
  - `record(pane, { at, method, path, status, ms, bytes, aborted })` -> entry {seq, pane, at, method, path, status, ms, bytes, aborted}; ring of maxEntries per pane, `dropped[pane]`.
  - `refused(pane, reason)` -> counts per pane per reason (reason from a fixed set; else 'other').
  - `mark(pane, type)` -> {seq, at, pane, type} or null when rate-limited (per pane gap) or over maxMarks (`marksDropped`).
  - `read(after)` -> { seq, marks (seq > after), requests (seq > after, each with `mark`: seq of latest mark with mark.at - 300 <= entry.at, else null = landing), dropped, refused, marksDropped }.
  Pane in {base, pr}; mark type in {click, submit, change, enter}.

proxy: options `recorder: () => (entry => void) | null` (bound at request start, called once per forwarded request at
res 'close' with {at, method, path(raw req.url sanitized by recorder? no: proxy passes raw; log sanitizes), status, ms,
bytes, aborted}) and `onRefused(reason)` for guard refusals (host: 'misdirected', paneRefusal strings, 'capability').
Bridge, /__qa/enter and 503-no-session are not forwarded: not logged.

server: `evidence` (session store) = null at startBoot (runBoot) and teardown; created at ready (with freshPanes).
Proxies: recorder: () => evidence?.recorder(role) ?? null; onRefused: r => evidence?.refused(role, r).
Routes (behind capability, same-origin, harness host):
- GET /api/actions?after=<n> -> 200 { active, ...read(after) } (active false: empty lists), no-store. Not activity.
- POST /api/actions/mark {pane, type} (JSON_ROUTES) -> 409 no session; 400 bad pane/type; 200 {recorded: bool}. Not activity.
json(): add `cache-control: no-store` to every API response? -> only these routes (data responses) to keep diff small.
harness: on bridge `event` (mirroring on or off): click/submit/change, keydown Enter -> 'enter'; client throttle 100 ms/pane; postJson('/actions/mark').
Docs: README HTTP API rows + Security bullet "The action log" + CHANGELOG under Unreleased.

## PR B — agent/w1-issue-8b (stacked): inspector seam + diffs + flags + demo adapter ("Part of #8")
lib/data-diff.mjs (pure, exported ./data-diff): sanitizeSnapshot (caps 10,000 rows/collection, 32 MB, recount, truncation),
masking (secret-like names + classify secret -> {masked:'secret'} shown as "changed"; pii -> {fp: 8-hex HMAC(sessionKey),
type, length}), strings cut 200, objects/arrays -> JSON (cut), blobs -> {digest,length}; diffCollections(before, after, rules)
-> per collection {inserted, updated (field level), deleted, countBefore, countAfter, truncated}; volatile ignore/presence;
divergence(baseDelta, prDelta) -> per key pr-only/base-only/both/differs, inserts by key else count; flags (delete, emptied,
dropped, column dropped, mass change >20 or >20% of >=5, cleared field amber; red PR-only, amber both; per-collection
destructive rules); trust = isolation verdict === 'isolated' ? 'trusted' : 'advisory'.
session.mjs: inspector.open after seedPane (per pane), S0 after open, S1 after establishSession; failures never fail boot.
server: GET /api/data, POST /api/data/snapshot {rebaseline}; /api/state data.available; teardown closes probes first;
racing snapshot 409; explicit data actions touch(). SSE {kind:'capture', pane, phase, ok} only.
demo: cart/messages/saved carts on db; inspector; PR fixture whose Empty cart also deletes saved carts (red, PR-only).

### data-diff detail (decided)
Cells (values after sanitize, compared by canonical JSON): null | boolean | finite number | string<=200 |
{t:'json', s} (object/array JSON <=200) | {t:'long', s:first200, len, d} (string/JSON >200, d = HMAC digest) |
{t:'secret', d} | {t:'pii', fp: 8hex HMAC, type, len}. Non-finite numbers -> null. Session HMAC key shared by both panes.
Secret = field name matches /pass|secret|token|salt|hash|otp|api_?key|private|session|card|ssn|iban/i or classify as 'secret';
pii = classify 'pii'. Key fields keep their mask (row key = JSON of key cells). Volatile: ignore -> field dropped;
presence -> boolean set/unset. Exclude -> collection dropped at sanitize. Rules validated at startConductor (inspector.rules),
names exact or '*' glob.
Collection = {key: string[]|null, fields: string[]|null, rows, count, truncated}. Truncated either side -> counts only.
diff(before, after) per collection: status same|changed|added|dropped, inserted[], updated[{key, fields:[{field,before,after}]}],
deleted[], countBefore, countAfter, truncated, fieldsDropped[]. key null -> multiset by canonical row.
divergence(baseDiff, prDiff): per collection status same|both|pr-only|base-only|differs; per change {kind, key, status, base, pr};
keyed: union of keys; unkeyed: inserted/deleted counts compared.
flags(baseDiff, prDiff, rules, {trusted}): kinds delete (incl. soft delete), emptied, dropped, column-dropped, mass-change
(>maxChanged default 20, or >20% of countBefore>=5), cleared (amber max). Severity: red if base count of that kind is 0,
amber if base did it too; when !trusted (isolation != isolated) base never excuses -> destructive kinds red. allowDeletes.
Spans: boot (S0->S1) and session (S1->Sn). Trust: 'trusted' iff isolation verdict 'isolated', else 'advisory'.
If PR B grows past ~1500 lines: split pure engine (8b) from seam+server+demo (8c), panels+CSP last (8d, Fixes #8).

## PR C — agent/w1-issue-8c (stacked): harness Data + Actions panels + CSP ("Fixes #8")
textContent only; Data badge counts red PR-only flags; divergence default; Snapshot now / Re-baseline;
Actions polling /api/actions?after; CSP: script-src 'self'; object-src 'none'; base-uri 'none'; frame-src <pane origins>.
