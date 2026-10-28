**Draft. Depends on #34; review only the commits after 07098b8** (#34's head): `07098b8..79e3efc`. That is 4 commits plus 3 merges of #34, 5 files. The rest of the diff is #34. This branch follows #34 by merging, never by rebasing.

Part of #8. This is the second of four PRs for #8's MVP (D = a):
- **A, #34:** the action log and the harness's marks.
- **B, this PR:** the data checks' pure engine, exported as `./data-diff`.
- **C:** the read-only `adapters.inspector` seam, the seeded and ready baselines with "Snapshot now" and "Re-baseline", the `/api/data` routes, and the demo inspector.
- **D:** the harness's Data and Actions panels and the tighter CSP. Only D is marked as completing issue 8.

Nothing calls the engine yet: PR C does.

## Judgment calls (conservative defaults; say if you want another)

- **A. Four PRs, not three.** The planned PR B, with the engine, the seam, the routes and the demo, came to about 2,000 lines. So the engine is its own PR, and the panels move to D.
- **B. A secret shows as a digest, not just "changed".** It is `{t: 'secret', d}`, where `d` is an HMAC under a key made for the session, which never leaves the conductor.
  - The digest is the field's: equal secrets in two fields don't match.
  - The diff needs it to tell a change, and a key field that looks secret (`session_id`) still needs to match rows.
  - It shows only whether two values are equal.
- **C. Personal data is a fingerprint, its type and its length** (owner decision B), and the fingerprint isn't per field. So the same email in two tables matches, which helps a reviewer follow a row. Its length shows, as the design says.
- **D. `SECRET_NAME` is broad.** It masks some names that hold no secret, such as `is_private`, `hashtag` and `card_count`. A wrong mask costs a value on screen; a missed one shows a secret. A secret-looking name stays secret even when `classify` says `pii`.
- **E. JSON held in a string is parsed and shown as JSON,** so values under secret-looking keys in it are masked. A change of whitespace alone in such a string doesn't show.
- **F. A value that isn't set (`null`, `''`, `[]`, `{}`) is kept as it is, even in a secret or pii field.** So clearing one shows, and an empty value tells nothing.
- **G. A truncated collection compares only counts, and never claims nothing changed.** Its status is `unknown` when the count stayed put, or when only one pane's is truncated.
  - **Its budget is shared fairly:** the fewest rows first, each with at most an equal share of what is left, and at most 1,000 collections. One collection can't starve the others.
  - **A collection the PR pane cut short where the base's wasn't,** or a cut-short one whose count changed, is a red `unverified` flag. It is amber only when trusted and the base was cut short with the same change.
- **H. A flag is amber only when the base made the same change (`shared`), and only when `trusted` is `true`.**
  - **The same change means:** the same rows by key (or as a multiset), with the same fields changed; the same field; or, for two cut-short collections, the same change in count.
  - **Counts:** a count stands for rows only when both panes have only counts.
  - **Otherwise the flag is red.** Following the owner's rule, an advisory session (any isolation verdict but `isolated`) makes every flag red. A `cleared` field is amber at most.
  - **`shared` is reported** whatever the trust, so the harness can say which changes only the PR made.
- **I. The design's thresholds, as written.** A mass change is more than 20 rows, or more than 20% of a collection of at least 5. So 2 changed rows of 5 is one. `maxChanged` overrides that per collection.
- **J. Rules are plain data, checked strictly.** An unknown list, or an entry with a field no rule has (`allowDelete`), throws at start. A rule naming a collection exactly wins over a glob.

## What changes

- **`lib/data-diff.mjs`, exported as `@critical-labs/qa-conductor/data-diff`.** It has no I/O:
  - `validateRules`: the inspector's rules, `exclude`, `volatile` (`ignore` or `presence`), `classify` (`secret` or `pii`), `softDelete` and `destructive`, with `*` globs;
  - `createMasker` and `sanitizeSnapshot`: what a snapshot keeps. That is at most 10,000 rows a collection and 32 MB in all, with each collection's true count and values as cells (above). Anything malformed, or that throws as it is read, is a problem, never a throw. Names such as `__proto__` are ordinary;
  - `diffSnapshots`: inserted, updated (field by field) and deleted rows, by key or as a multiset, with schema changes named once;
  - `divergence`: per collection and per change, `both`, `pr-only`, `base-only`, `differs`, plus `unknown` for a truncated collection;
  - `flagChanges`: `delete` (soft deletes too), `emptied`, `dropped`, `column-dropped` (per field), `mass-change` and `cleared` (per field), red or amber as above;
  - `trustOf`: `trusted` only when the isolation verdict is `isolated`.
- **Docs:** the entry point's row, a README section "Data checks", and a CHANGELOG section under `## [Unreleased]`.

## Where values could leak

Nowhere yet: nothing calls the engine. In PR C its output reaches only `GET /api/data`, behind the capability. Never the event stream, a log or GitHub (C = c).

## Tests and review

- **Tests:** 774 passed on Node 24 and on Node 22 (`npm test`). 33 are in `test/data-diff.test.mjs`, all new.
- **The orchestrator's review** (two high, three medium, lows) is answered in `79e3efc`, item by item in a comment. 17 hand mutants of that round's changes, all killed after three more tests.
- **Self-review:** a reviewer agent ran probes against the first commit and found 20 items, all fixed test-first in `0e24c9f`. Two were high:
  - flags were judged by counts, not rows;
  - `trustOf`'s string passed as `trusted` would read as trusted.

  Nine were medium:
  - JSON held in strings kept secrets;
  - clearing a secret went unseen;
  - `SECRET_NAME` missed many names;
  - a schema change in a collection without a key read as every row changed;
  - a diff named a key it didn't use;
  - truncated collections claimed `same`;
  - soft deletes stored as 0/1 were missed;
  - `__proto__`-style names broke diffs;
  - the cost of rules per cell.

  The rest were low.
- **Mutation:** 40 hand mutants of the engine as fixed. 35 died at once, and `5cf2b16` adds tests that kill the other 5:
  - soft deletes stored as `0` and as `false`;
  - an invalid date at the top level;
  - the flags' field order;
  - the key a diff used.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MkcLhvB2oguJrgFNRVqAxy

