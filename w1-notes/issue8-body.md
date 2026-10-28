Session data diff and action log: verify what a PR did to the data, not just how it looks

## Summary

Add two views to a QA session: a **data diff** (what changed in each pane's database since it was seeded) and an **action log** (what requests each pane handled and what external APIs its app called). They let a reviewer confirm that the data a visual change touches was manipulated as expected, or at least that nothing destructive happened, before accepting the PR.

## Motivation

The harness shows how base and PR *look* side by side, but a change that looks right can still write the wrong thing: a delete that cascades too far, an update that clobbers unrelated fields, a duplicate insert, or a call to a real external API (email, storage, payments) that should never happen. Today the only way to catch that is to inspect each pane's database by hand, outside the harness. Both panes start from the same seed and receive the same mirrored actions, so the harness is in a unique position to show where the PR's *data behaviour* diverges from base's.

## Proposed approach

### 1. Data diff
- **Baseline snapshot** of each pane's data right after seeding, before the app starts. The reviewer can diff against the current state at any time during the session.
- **Per-pane diff:** inserted, updated (field level) and deleted rows or items, grouped by table or collection.
- **Divergence view (the key one):** compare base's delta with the PR's delta and highlight where they differ, such as extra deletes, missing writes or different field values. Adapter-supplied rules normalise volatile fields (timestamps, generated ids).
- **Destructive-change flags:** deletes, drops or truncates, and mass updates above a threshold, highlighted with summary counts.
- **New optional seam**, for example a `DataInspector`: `snapshot({ paneRef, db, signal })` returns normalised collections, together with `keyOf(collection, row)` and ignore rules. The core diffs and renders; adapters only read. When the seam is absent, the views are hidden.
- **Reference implementations:**
  - Postgres (homefree): per-table reads keyed by primary key, with size caps.
  - DynamoDB Local (agent-identity): a Scan of the pane table.
  - The demo's fake adapters.

### 2. Action log
- **Inbound:** the pane proxies already see every browser→app request. Record the pane, method, path, status and duration, and correlate each entry with the mirrored action that caused it. Auth headers, cookies and tokens are never recorded, and bodies are off by default.
- **Outbound:** calls the app makes to external services are invisible to the proxy. Optionally route pane egress through a per-pane recording proxy (for example `HTTP(S)_PROXY` set via the EnvTransform), logging host, method and status; HTTPS is logged at host level via CONNECT, without interception. An optional host allowlist can **block** unexpected external calls as a safety net.
- **Database writes (optional, adapter-provided):** for example Postgres `log_statement = mod` in the pane database.
- **UI:** one timeline with both panes side by side, aligned by mirrored action, with a writes-only filter and a jump to the data diff at that point.

### 3. Harness UI and verdict
- The session view gets **Data** and **Actions** panels, per pane plus the base-vs-PR divergence view.
- The verdict comment can include a data-change summary (counts and destructive flags only). It never includes values, because pane data may be real, redacted production data.

## Acceptance criteria
- [ ] An optional, documented seam for data snapshots; with no adapter, the new panels are hidden.
- [ ] A baseline is taken after seeding; the per-pane diff (inserted, updated with field-level detail, deleted) is available at any point in a session.
- [ ] The divergence view highlights where the PR's data changes differ from base's after the same mirrored actions.
- [ ] Destructive operations are flagged prominently.
- [ ] Inbound request log for both panes, correlated with mirrored actions, never recording credentials.
- [ ] Outbound egress log (at least host, method and status), with an optional host allowlist that blocks unexpected calls.
- [ ] Working in homefree (Postgres), agent-identity (DynamoDB Local) and demo mode, with tests.
- [ ] The verdict comment can include a value-free data-change summary.

## Open questions
- Size limits and sampling for large tables.
- How adapters declare volatile fields.
- Whether to offer opt-in HTTPS interception (a local CA) for full outbound request detail.

