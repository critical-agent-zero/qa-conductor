## Design: session data diff and action log

This is a design only: no code, no branch. It came from three independent drafts (MVP-first, security-first and consumer-adapter-first), was synthesised, and was then checked line by line against `main` at [`e9bef2a`](https://github.com/critical-labs/qa-conductor/tree/e9bef2a). Each claim about today's code links to its lines.

### TL;DR
- **A new optional, read-only seam, `adapters.inspector`.** The core opens one probe per pane right after `seedPane` and takes two baselines: **seeded** (before any PR code runs) and **ready** (after migrations and sign-in, before the reviewer's first request). It also diffs on demand. The core does all diffing, divergence and flagging; adapters only read.
- **An action log that needs no adapter.** The pane proxy records every browser→app request with no values in it. The harness posts value-free "marks" for each mirrored action, so requests and data changes group under the action that caused them.
- **Outbound calls: a core recording proxy** (Phase 2). The consumer's EnvTransform wires it in through `pane.egress`. It logs, or blocks hosts outside an allowlist, and never intercepts TLS.
- **Memory only, scoped to the session like the cookie jars.** Values reach only the gated harness, with secret-like fields masked. The verdict comment gets counts only.
- **Recommended MVP:** the inbound log and marks, the inspector with per-pane and base-vs-PR diffs, destructive flags, and the demo adapter. Egress and change feeds come later.

---

### 1. Problem, goals, non-goals
**Problem.** The harness shows how base and PR *look*. A change can look right and still write wrong:
- a cascading delete or a clobbered field;
- a duplicate insert;
- a real email, payment or storage call.

Today the only check is opening each pane's database by hand.

**Goal.** For any change under QA, the reviewer can confirm that every data change happened as expected, or at least that nothing destructive happened, in the databases and in calls to other services, before giving a verdict.

**Terms, per QA session**
| Term | Meaning |
|---|---|
| **Snapshot** | Each pane's data, read through the inspector: `seeded` (S0), `ready` (S1), `now` (Sn) |
| **Boot delta** | S0 → S1 for one pane: what migrations and sign-in did. A destructive PR migration shows up here |
| **Session delta** | S1 → Sn for one pane: what the reviewer's actions did, i.e. before vs after within a pane |
| **Divergence** | Base's session delta against the PR's, matched by key: `pr-only`, `base-only`, `both`, `differs`. Both panes start from the same seed and get the same mirrored actions, so this is where the PR's data behaviour departs from base's |
| **Action log** | One timeline per session: marks (mirrored UI actions), inbound requests per pane, and later egress calls and change-feed entries |

**"Destructive", operationally.** Each flag is **red** when only the PR did it and **amber** when base did it too. Thresholds can be set per collection.
- **Delete:** a baseline row is gone, or newly soft-deleted where the adapter declares a soft-delete field.
- **Emptied or dropped:** a collection whose count falls to 0, or that disappears. This catches a truncate or a drop.
- **Column dropped:** a declared field disappears.
- **Mass change:** updates plus deletes in one collection exceed 20 rows, or 20% of a collection of at least 5 rows.
- **Cleared field** (amber at most): a value that was set becomes `null`, `''`, `[]` or `{}`.
- **Egress (Phase 2):** a blocked call, or a non-GET to a host outside the allowlist.

**Non-goals**
- **A security boundary against a malicious PR.** It detects mistakes, not malice (see §5).
- TLS interception, request or response bodies, and consistency across databases.
- Any write to pane data by the core.

---

### 2. Where it fits

**What today's code dictates**
- **`db` never reaches the server.** `bootSession` keeps it in its local `panes` array ([session.mjs L150-L153](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/session.mjs#L150-L153)), and hands it to the seams that need it. It returns only `{ baseTag, prTag, loginUrls, upstreams }` ([L200](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/session.mjs#L200)). So the probe has to be opened inside the boot, and the core keeps the probe, never the `db`. A Docker pane's DSN carries the database superuser's password.
- **The boot writes after seeding.**
  - `runMigrate` runs after `seedPane` for one-shot-image builds ([L164-L169](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/session.mjs#L164-L169)); on-boot builds migrate when the app launches ([L177-L183](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/session.mjs#L177-L183)).
  - An AuthBootstrap's `establishSession` may write sign-in rows ([L192-L197](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/session.mjs#L192-L197)).
  - A seed-only baseline would charge those writes to the reviewer, hence two baselines.
- **No reviewer request reaches a pane before the boot returns.** `upstreams` stays null until then ([server.mjs L305-L312](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L305-L312)), and the proxy answers `503` meanwhile ([proxy.mjs L314-L318](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/proxy.mjs#L314-L318)). So `ready` is a clean baseline.
- **Mirroring is a browser-side relay.** The bridge posts events to the harness page, which relays them to the other pane ([harness.js L385-L389](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/public/harness.js#L385-L389)). The server never sees a UI action, so the harness reports marks. Bridge events carry form values ([bridge.js L178-L181](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/public/bridge.js#L178-L181)), which marks drop.
- **The proxy sees every browser→app request and its status** ([proxy.mjs L324-L358](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/proxy.mjs#L324-L358)), bound to the session's jar at request start ([L321-L323](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/proxy.mjs#L321-L323)). Requests its guard refuses return before forwarding ([L292-L304](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/proxy.mjs#L292-L304)). It does **not** see calls the app makes server-side.

**New seam: `DataInspector` (`adapters.inspector`, optional)**
Like `provisionDatabase` and `seedPane`, it takes one object argument and may return a promise, and `db` stays opaque to the core ([README: The seams](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/README.md#the-seams), [Contracts](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/README.md#contracts-between-the-seams)). The Contracts text, which names `db`'s recipients, gains the inspector. `db` may be `null`, since the process Provisioner can return no database, so `open()` must accept it.

```js
/**
 * @typedef {object} DataInspector                     adapters.inspector (optional)
 * @property {DataRules} [rules]                       plain data; startConductor validates it
 * @property {(a: {paneRef: PaneRef, db: unknown, databases: string[], signal: AbortSignal})
 *            => Promise<PaneProbe>} open
 *   Called in bootSession right after seedPane, with the same `db`. Must not write (Phase 1).
 */
/**
 * @typedef {object} PaneProbe                         one per pane per session; the core keeps it
 * @property {(a: {limits: Limits, signal: AbortSignal}) => Promise<Snapshot>} snapshot   read-only
 * @property {(a: {since: string|null, limits: Limits, signal: AbortSignal})
 *            => Promise<ChangeBatch>} [changes]       Phase 3: optional change feed (triggers, Streams)
 * @property {() => Promise<void>} [close]             frees conductor-side resources only; never touches the store
 */
/** @typedef {{ maxRows: number, maxBytes: number, timeoutMs: number }} Limits */
/**
 * @typedef {object} Snapshot
 * @property {Record<string, Collection>} collections  e.g. 'app.public.orders', 'AGENT/PROFILE', 'cart'
 */
/**
 * @typedef {object} Collection
 * @property {string[]|null} key                       identity fields from the store's own schema (PK, KeySchema); null → multiset diff
 * @property {Array<Record<string, Json>>} rows        plain JSON values, ordered by key, at most limits.maxRows
 * @property {number} [count]                          true row count: a truncated collection still flags deletes and emptying
 * @property {boolean} [truncated]
 * @property {string[]} [fields]                       declared columns, so a dropped column is seen (omit if schemaless)
 */
/**
 * @typedef {object} DataRules                         collection names match exactly or with '*' globs
 * @property {string[]} [exclude]                      never read, never shown (e.g. migration and session tables)
 * @property {{collection: string, fields: string[], mode?: 'ignore'|'presence'}[]} [volatile]   timestamps, generated tokens
 * @property {{collection: string, fields: string[], as: 'secret'|'pii'}[]} [classify]          see §5
 * @property {{collection: string, field: string}[]} [softDelete]
 * @property {{collection: string, maxChanged?: number, allowDeletes?: boolean}[]} [destructive]
 */
```
- **Rules are data, not callbacks.** The issue's `keyOf(collection, row)` becomes `key`, named by the adapter from the store's schema. A callback runs per row, can throw mid-diff, and can differ between panes; data can be validated, tested and shown ("4 volatile rules hid 9 changes"). The defaults hide nothing.
- **Pure core code.** `lib/data-diff.mjs` holds the snapshot sanitising, diffing, divergence and flagging, with no I/O. It is exported (as `./data-diff`) so adapters can test their output against it.
- **With no inspector,** `/api/state` carries `data: { available: false }` and `GET /api/data` answers the same. The Data panel is hidden and the boot is unchanged. The action log still works.

**Core changes, all small and optional**
| Where | Change |
|---|---|
| `bootSession` | `open()` both probes after `seedPane`, take S0, take S1 after the `establishSession` loop, and return `data: { probes, seeded, ready, errors }`. A failing or slow inspector never fails the boot |
| `createPaneProxy` | an `onExchange(entry)` option, called per forwarded request with the entry bound at request start, like `sessionJar`, plus a per-reason count of the requests its guard refuses |
| `startConductor` | an evidence store per session; routes `GET /api/data`, `POST /api/data/snapshot` (`{ rebaseline: true }` for Re-baseline and Retry), `GET /api/actions?after=`, `POST /api/actions/mark` |
| harness | **Data** (`d`) and **Actions** (`a`) drawers. Marks are posted from the existing bridge-event handler, whether or not mirroring is on |
| `formatVerdict` | an optional `dataSummary` holding counts only (§5) |

**Capturing outbound calls (Phase 2)**

**E1, a core recording proxy (★).**
- **What:** a zero-dependency HTTP and `CONNECT` proxy per pane, on `node:http`/`node:net`. The core offers it to `derivePaneEnv` as `pane.egress = { proxyUrl, noProxy }`. The EnvTransform, which already owns side-effect neutralising, decides whether and how to set `HTTP(S)_PROXY` / `NO_PROXY` (and `NODE_USE_ENV_PROXY=1` for Node apps).
- **What it logs:** method, host, path and status for plain HTTP; host, port and bytes for HTTPS, from `CONNECT`, with no interception.
- **Blocking:** an allowlist mode refuses other hosts.
- **Always refused:** loopback, link-local (including `169.254.169.254`), multicast and the conductor's own addresses. The proxy must never become a route from PR code to the harness with a forged identity header.
- **Trade-offs:**
  - It is cooperative: an app or SDK that ignores proxy settings goes unseen. That is why the egress log is advisory unless the pane's network is also locked down (Phase 3).
  - Docker panes on a native Linux bridge can't reach the host's loopback, so the Provisioner gets an optional `egressRoute({paneRef}) → { listenHost, proxyHost }`.

**E2, consumer hooks (available from the MVP).**
- **What:** the EnvTransform's neutralised mailer, storage or payment stubs record what they were asked to do, and the inspector returns that as `outbound.*` collections. They then appear in the same diff and divergence.
- **Trade-offs:** rich detail with no new core, but it misses an unexpected, uninstrumented call, and it relies on app code the base may not have.

**Rejected**
- **TLS interception** (a local CA): the CA key becomes a credential, and the request bodies it reveals would hold API keys.
- **Packet or DNS capture:** needs privileges, and differs by platform.

---

### 3. Data flow and lifecycle

**Snapshot points**

| When | Where | Purpose |
|---|---|---|
| `seeded` (S0) | right after `seedPane`, before migrations and app launch | the one baseline no PR code has touched, unless the build ran install scripts |
| `ready` (S1) | end of `bootSession`, after `establishSession`, before `upstreams` is set | the session baseline. Boot delta = S0 → S1, after which S0 is dropped |
| `now` (Sn) | **Snapshot now** in the Data panel, and when the verdict preview opens | session delta = S1 → Sn, plus divergence |

- **Re-baseline** sets S1 to now, for example after a manual sign-in. It is always shown as such.
- Both panes are snapshotted in parallel, under the boot signal and `limits.timeoutMs`, and concurrent requests coalesce.
- **Failures never fail the boot.** They show as "baseline unavailable (reason)", with a Retry.

**Correlation, from UI action to requests to data**
- **Marks.** For each `click`, `submit`, `change` and Enter, the harness sends `POST /api/actions/mark {pane, type}`, which the server stamps `{seq, at}`.
  - **No values:** never the selector text or the typed value.
  - **Labelled "reported by pane":** PR code can post bridge messages.
  - **Limits:** at most 2,000 per session, and one per 100 ms per pane.
- **Grouping requests.** A request belongs to the latest mark with `mark.at − 300 ms ≤ request.at`, computed when read and labelled as approximate. Requests before the first mark are "landing".
- **Grouping data changes.** They group per mark only when a change feed exists (Phase 3). Until then, the reviewer's **Snapshot now** shows the net session delta, and the timeline places it at its own time.

**Storage**
- **Memory only.** The core writes nothing to disk.
- **Snapshots:** per pane, S1 and the latest Sn (S0 until `ready`), capped at 10,000 rows per collection and 32 MB per pane snapshot, with a 30 s timeout. The core re-counts and truncates whatever the adapter returns.
- **Truncation is honest.** A truncated collection reports only the change in its `count`, and a fall is flagged. It never claims "no deletes".
- **Logs:** ring buffers of 5,000 entries per pane, with a `dropped` count. Flagged entries go in a separate ring that ordinary entries can't evict, so a flood can't hide a destructive call.

**Interaction with boots and the per-pane cookie jars**
- **The evidence store follows the jar lifecycle exactly.**
  - It is discarded at `startBoot` and at teardown, where `clearJars()` runs ([server.mjs L292](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L292), [L353](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L353)).
  - It is installed at ready ([L311](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L311)).
  - Teardown closes the probes **before** `teardownSession`.
- **Each log entry binds its session's store at request start,** as the proxy binds `sessionJar`. A late response from an old session lands in the discarded store, never the new one.
- **A late or aborted operation never touches the store.**
  - An aborted boot never calls an inspector again: a newer session may own the deterministic panes, so `close()` never touches the store.
  - A snapshot that finishes after a takeover is dropped, and its route answers `409`.
- **The inspector never uses a jar,** and nothing the log keeps reads `Cookie` or `Set-Cookie`. The per-pane, per-session cookie jar isolation shipped in 0.3.1 is unchanged.
- **Idle time:** explicit data actions (Snapshot now, Re-baseline) count as activity, through the same `touch()` the proxies' `onActivity` uses ([proxy.mjs L312](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/proxy.mjs#L312), [server.mjs L563](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L563)). The Actions view's polling does not, or an open tab would keep the idle reaper from ever ending the session.

---

### 4. Harness UI

Text wireframe. Everything renders with `textContent`, and below 900 px wide Data and Actions become tabs.
```
#102 · main@9f8e vs #102@1a2b │ Mirror │ Re-sync │ 375 768 Full │ [Data ⚠1] [Actions] │ auto-end 24:10 │ End
──────────────────────────────────────── panes ────────────────────────────────────────
Data (d)   baseline: ready 14:02 · compared 14:09   [Snapshot now] [Re-baseline]
  Span: (•) session  ( ) boot      View: (•) divergence ( ) base ( ) PR
  ⚠ PR-only destructive: saved_carts 3 deleted (base 0) · messages.topic cleared ×1
  collection        base Δ        PR Δ           status
  cart_items        +1 ~0 −2      +1 ~0 −2       both (amber: deletes in both)
  saved_carts       —             −3 ⚠           PR only
  messages          +1            +1             differs: topic
    ▸ id 42 │ topic │ base "billing" │ PR "" (cleared) │ updated_at hidden (volatile)
  users             count only 1204 → 1204       truncated
  2 excluded · 4 volatile rules hid 9 changes · secrets shown as "changed"

Actions (a)   [writes only ☑] [flagged only ☐]                      ● polling
  #14 14:05:09 click (reported by PR pane)
     BASE  POST /cart/clear 303 12ms · GET /cart 200
     PR    POST /cart/clear 303 15ms · GET /cart 200                   [Δ data at 14:05:12]
     PR ↗  CONNECT api.mailer.example:443  ✕ blocked ⚠                (Phase 2)
  landing  GET /sign-in?… 302 · …          dropped 0 · refused 3 (cross-site)

Verdict drawer: ☐ include data summary (counts and flags only)
```
- **The Data button's badge** counts red, PR-only flags.
- **Divergence is the default view.** Clicking a collection shows key-level rows with field-level before and after values.
- **The Actions view polls `GET /api/actions?after=<seq>`.** It doesn't use SSE, for two reasons:
  - the harness closes its event stream on `ready` ([harness.js L303](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/public/harness.js#L303));
  - the server replays the progress log to every client ([server.mjs L510-L516](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L510-L516)).

---

### 5. Security and privacy

**Threat model**
- PR code is untrusted, and pane data is redacted production data that may still hold PII.
- **An existing limit, not new with this design:** the base pane is not isolated from PR code. README's Known limits doesn't list it yet.
  - With the Docker Provisioner, both panes' Postgres containers share one network ([provisioner-docker.mjs L51-L60](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/adapters/provisioner-docker.mjs#L51-L60)) and one superuser, `qa`/`qa` by default ([docker.mjs L71-L82](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/docker.mjs#L71-L82)).
  - With the process Provisioner, each pane's database listens on its host, which is loopback by default ([provisioner-process.mjs L155-L156](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/adapters/provisioner-process.mjs#L155-L156), [L534-L555](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/adapters/provisioner-process.mjs#L534-L555)).
  - So the capture **detects mistakes, not malice**, and the trust gate remains the boundary.

**Three rules**
1. The capture never widens what PR code can reach.
2. It never puts a PR-controlled string where the string acts: the harness DOM, the verdict comment, SQL, or logs.
3. It never outlives the session unless the owner opts in.

**Controls**
| Surface | Control |
|---|---|
| **Harness API** | New routes sit under `/api/*`, so they inherit: the identity gate in tailscale mode, which wraps the whole server ([server.mjs L173](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L173), [L469](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L469)); the `Host` check; the same-origin and harness-host refusals; and, for the POSTs, `503` during shutdown ([L439-L444](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L439-L444)). The two POSTs join `JSON_ROUTES` ([L54](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L54)). Data responses get `cache-control: no-store`; today's `json()` sets none ([L371-L375](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L371-L375)) |
| **Inbound log** | Keeps method, path (query **values** dropped, token- and email-like segments masked, 200 characters max), status, duration and bytes. **Never** headers, `Cookie`, `Set-Cookie`, `Authorization`, `Tailscale-*` or bodies. Requests the guard refuses only bump a counter, so other pages can't write log entries |
| **Values in the Data panel** | Shown only to the gated harness. Every allowed login already drives the operator's session in the panes, so it sees this data anyway. Masked by default: field names matching `pass\|secret\|token\|salt\|hash\|otp\|api_?key\|private\|session\|card\|ssn\|iban`, and `classify` declarations. `secret` shows only "changed"; `pii` shows an 8-hex HMAC under a key made fresh for each session, plus type and length. Strings are cut at 200 characters, and blobs become `{digest, length}` |
| **SSE** | The progress log replays to every client, so data events carry no values: `{kind: 'capture', pane, phase, ok}` |
| **Verdict comment** | `dataSummary` takes only non-negative integers under fixed labels: counts of inserts, updates, deletes and flags, per pane and PR-only. **No collection names, hosts, paths or keys**, because PR code controls them, and the comment is posted with `GITHUB_QA_TOKEN` (markdown, @-mentions, links). A test plants marker strings and asserts that none reaches the comment |
| **Harness DOM** | The new panels pour PR-controlled strings into the page that posts verdicts. So they use `textContent` only. The harness's CSP, today only `frame-ancestors 'self'` ([L60-L64](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/lib/server.mjs#L60-L64)), gains `script-src 'self'; object-src 'none'; base-uri 'none'; frame-src <pane origins>`. The page loads only `/qa/harness.js` and has no inline script, so that costs nothing |
| **Egress proxy** | Accepts proxy-form requests only, plus a per-pane token that changes each boot. Always refuses loopback, link-local, metadata and the conductor's own addresses. Flags private and Tailscale (`100.64.0.0/10`) addresses as `internal`. Never mounted with `tailscale serve` |
| **Disk** | The core writes nothing. DB statement logging stays off, since it would put values in container logs. Console output is limited to counts and error names. An archive is a later opt-in |
| **Cookie isolation** | Unchanged: the log and the inspector never read a jar, and the evidence store resets with the jars |

---

### 6. Approaches considered
| | Approach | For | Against |
|---|---|---|---|
| **A ★** | **Snapshot diff:** a read-only inspector, with the core diffing | works on any store (Postgres, DynamoDB Local, dynalite, in-memory); small adapters; one shared semantics; ground truth | costs grow with data (hence caps); net effect only, no per-action timing without B |
| B | **Change capture:** triggers, logical decoding, DynamoDB Streams | exact, ordered, per action | needs per-store setup that changes the database under test; a migration can break it; `runPg` sets no `wal_level`, and dynalite may lack Streams |
| C | **Request log only** (no inspector) | no adapter at all | shows intent, not effect: a 303 says nothing about which rows went |
| D | **In-page capture:** the bridge wraps `fetch` | no proxy changes | PR code can forge or hide it, and it can't see server-side effects |

**Recommendation:** A as the core, plus C from day one, which is nearly free and useful with no adapter. B arrives later as the optional `changes()`, used for the timeline while snapshots stay the truth; a feed that disagrees with the snapshot delta is flagged "incomplete". D is rejected.

---

### 7. Phasing and acceptance criteria

**Phase 1 (MVP): the inbound log, marks, the inspector, both diffs, divergence and flags**
- [ ] **With no inspector,** the Data panel is hidden, `/api/data` reports `available: false`, the boot is unchanged and the existing tests pass untouched. The Actions view works.
- [ ] **A failing inspector never fails the boot.** One that throws, hangs or returns too much still lets the session reach `ready`, with "baseline unavailable" shown and Retry offered.
- [ ] **Diffs:** per-pane boot and session deltas, with inserted, updated (field level) and deleted rows. `volatile` fields never count as updates, and a truncated collection reports only the change in `count`.
- [ ] **Divergence** marks deletes and updates by key as PR-only, base-only, both or differs. Inserts are matched by key, else by count.
- [ ] **Destructive flags** as defined in §1, with red and amber severity, and a header badge.
- [ ] **Inbound log:** a request carrying `Authorization`, `Cookie` and `?token=abc` leaves none of those values in any `/api/*` response or SSE event. A late response after `clearJar` isn't recorded in the new session.
- [ ] **Marks:** value-free and rate-limited. Requests group under them in the Actions view.
- [ ] **Lifecycle:** evidence is gone after teardown, takeover and the next boot, and a racing snapshot answers `409`.
- [ ] **Route checks:** the new POSTs answer `415` for non-JSON, `403` cross-site, `503` during shutdown, and the gate's `403`, tested as the existing routes are.
- [ ] **Rendering:** values render inert (`<img onerror>` stays text); `secret` fields never appear in a response; `pii` appears only as a fingerprint.
- [ ] **Harness:** the CSP and `no-store` are in place.
- [ ] **Demo:**
  - The pane app's cart and messages, held in the app instance today ([demo/pane-app.mjs L283](https://github.com/critical-labs/qa-conductor/blob/e9bef2a/demo/pane-app.mjs#L283)), move onto `db`.
  - The demo gains saved carts, which only the fake seed's log line mentions today.
  - It gets an inspector.
  - A demo PR whose "Empty cart" also deletes the saved carts is flagged red, PR-only. The wireframe in §4 shows this case.
- [ ] README (the seam, its types, contracts and known limits) and CHANGELOG updated; `docs.test.mjs` passes.

**Phase 1.1: verdict summary**
- [ ] An opt-in checkbox and `dataSummary` with counts only. A marker-string test and a test with a hostile collection name (`[x](https://evil) @team`) both pass.

**Phase 2: egress**
- [ ] E1 with `cfg.egress = { mode: 'off'|'record'|'block', allow: [] }`, `pane.egress` for `derivePaneEnv`, and `egressRoute` for Docker panes.
- [ ] Loopback, `::1`, `169.254.169.254` and the conductor's ports are refused even in record mode. A request without the pane token gets `407`, and an origin-form request `400`.
- [ ] In block mode, an unlisted host is refused and logged as flagged, and 10,000 unflagged entries never evict a flagged one.
- [ ] A demo call to an unlisted host shows in the Actions view. With egress unconfigured, nothing changes.

**Phase 3: scale and depth**
- [ ] `changes()` feeds grouped per mark: Postgres audit triggers, and DynamoDB Local Streams where available. There is a cross-check against the snapshots.
- [ ] Insert matching for generated ids, by content minus `generated` fields.
- [ ] Per-pane networks or separate credentials, so the base is isolated from PR code. Egress enforced by an `--internal` network.
- [ ] An opt-in on-disk archive of the value-free summary, in a `0700` directory with `0600` files.

---

### 8. Open questions for the owner (★ = recommendation)
- **A. Baseline points**
  - a) seeded only, as the issue says. A PR migration then shows as the reviewer's changes.
  - b) ★ **seeded and ready.** The boot delta covers migrations and sign-in; the session delta covers the reviewer's actions.
  - c) ready only.
- **B. Values in the Data panel**
  - a) ★ **shown,** with secret-like names and `classify` masked, and `pii` as fingerprints.
  - b) every undeclared string fingerprinted (stricter, less useful).
  - c) counts only.
- **C. Verdict data summary**
  - a) ★ **opt-in per verdict, counts and flags only, no collection names.**
  - b) on by default, counts only.
  - c) never.
- **D. MVP scope**
  - a) ★ **the inbound log, marks, the inspector, both diffs, divergence and flags.**
  - b) the inspector only, with the log in Phase 2.
  - c) the log only, with the inspector in Phase 2.
- **E. Egress default once wired**
  - a) record only.
  - b) ★ **block hosts outside a consumer allowlist,** failing closed. Loopback and metadata are always refused.
- **F. HTTPS detail**
  - a) ★ **host level only (`CONNECT`), never intercepted.**
  - b) an opt-in local CA later.
- **G. Keys and volatile fields**
  - a) ★ **key fields named in the snapshot, plus data rules.**
  - b) `keyOf` and rule functions, as the issue sketched.
  - c) both.
- **H. The base pane is reachable from PR code** (Docker: a shared network and superuser)
  - a) ★ **document it as a known limit now, fix it in Phase 3.**
  - b) fix it before shipping #8.

---

### 9. Consumer adapters
These live in the consumers' repositories, and are sketched here only.

**homefree (Postgres, panes as containers)**
- **Where it reads:** through the `db.query(sql, { database })` its Provisioner already hands over, which is psql in the container with no shell and no published port. It covers each database the Seed declares.
- **What it reads, in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction per database, so every table is read at the same moment:**
  - primary keys from `pg_index`;
  - per table, `count(*)` and `json_agg` over `ORDER BY <pk> LIMIT maxRows + 1`;
  - identifiers quoted with `format('%I')`.
- **Rules:**
  - `exclude`: migration-history and session tables.
  - `volatile`: `*.updated_at`, plus sign-in token columns in `presence` mode.
  - `classify`: password hashes and tokens as `secret`; email, name and phone as `pii`.
  - `softDelete`: `deleted_at`.
- **Optional:** if the EnvTransform's mail stub keeps an outbox, it can appear as `outbound.email` (E2). In Phase 3, audit triggers installed by `open()`, read by `changes()`.

**agent-identity (DynamoDB Local, process panes)**
- **Handle:** `{ endpoint, tableName, region }`, as its `packages/qa` returns it.
- **What it reads:**
  - `DescribeTable` gives `key` from the `KeySchema`;
  - a paged, consistent `Scan` up to `maxRows`, with items unmarshalled to JSON;
  - collections split by the single-table key prefix.
- **Rules:**
  - `exclude`: nonces.
  - `volatile`: `updatedAt`, plus `expiresAt` and `ttl` in `presence` mode.
  - `classify`: an email key as `pii`, admin key material as `secret`.
- **Egress:** loopback panes can use E1 directly. **Phase 3:** DynamoDB Local Streams for `changes()`.

**demo (in this repository)**
- **Where the store goes:** the pane app's cart and messages, plus the saved carts the demo gains, move onto the `db` the demo Provisioner returns, and the pane app uses them there.
- **The inspector:** about 30 lines returning those tables.
- **The deliberate bug:** a PR fixture whose "Empty cart" also deletes the saved carts. This is the end-to-end test.

