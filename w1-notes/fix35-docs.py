R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
p = R + 'README.md'
s = open(p).read()


def sub(a, b):
    global s
    assert a in s, a[:70]
    s = s.replace(a, b, 1)


sub("  - `count` is the true row count, so a truncated collection still shows deletes and emptying. A collection with fewer rows than its `count` is truncated, and one marked `truncated` with no `count` is a problem;",
    "  - `count` is the true row count. A truncated collection shows only a net change in it: a fall reads as deletes, a rise as inserts, and what happened past the cut can't be seen. A collection with fewer rows than its `count` is truncated, and one marked `truncated` with no `count` is a problem;")
sub("  - `classify: [{collection, fields, as}]`: `as` is `secret` or `pii`;",
    "  - `classify: [{collection, fields, as}]`: `as` is `secret` or `pii`. It names top-level fields only. A value inside JSON is masked when its key looks secret, but `classify` doesn't reach it;")
sub("  - at most `LIMITS.maxRows` (10,000) rows a collection, and `LIMITS.maxBytes` (32 MB) in all. A collection cut short is `truncated`, and only its count is compared;",
    "  - at most `LIMITS.maxRows` (10,000) rows a collection, `LIMITS.maxBytes` (32 MB) in all and `LIMITS.maxCollections` (1,000) collections. The bytes are shared fairly: the collections with the fewest rows go first, each with at most an equal share of what is left, so one big collection, a PR's padding say, can't starve the others. A collection cut short is `truncated`, and only its count is compared;")
sub("    - a value under a secret-looking key inside JSON is masked too, and bytes inside it show only their length;",
    "    - a value under a secret-looking key inside JSON is masked too, with a digest of its collection's and field's. So is JSON held in a string inside JSON, up to three deep, and NDJSON line by line. Bytes inside JSON show only their length, and a `Set` or `Map` its entries;\n    - text that isn't JSON, or is over 256 KB, but shows a secret-looking key (`\"password\": …`, `api_key=…`) is masked whole: `[text with a secret-looking key, <length>, <digest>]`;")
sub("- **`diffSnapshots(before, after)`**: per collection, `{status, key, inserted, updated, deleted, fieldsDropped, fieldsAdded, countBefore, countAfter, truncated}`.",
    "- **`diffSnapshots(before, after)`**: per collection, `{status, key, inserted, updated, deleted, fieldsDropped, fieldsAdded, countBefore, countAfter, truncated, keyLost}`. `keyLost` says the after snapshot no longer bears out the key the before one had, for example because two rows share it.")
sub("  - The collection's `status` sums its changes up: `same` when there are none, or `unknown` for a truncated collection whose counts show nothing.",
    "  - The collection's `status` sums its changes up: `same` when there are none, or `unknown` for a truncated collection whose counts show nothing, or one truncated in one pane only, whose count can't be set beside the other's rows.")
sub("- **`flagChanges(baseDiff, prDiff, rules, {trusted})`**: the PR pane's destructive changes, each `{collection, kind, severity, pr, base, field?}`, where `pr` and `base` are how many each pane made.",
    "- **`flagChanges(baseDiff, prDiff, rules, {trusted})`**: the PR pane's destructive changes, each `{collection, kind, severity, shared, pr, base, field?}`. `pr` and `base` are how many of that kind each pane made, on any rows. `shared` says the base made the same change.")
sub("    - `mass-change`: more than 20 rows updated or deleted, or more than 20% of a collection of at least 5 rows, or past a rule's `maxChanged`;",
    "    - `mass-change`: more than 20 rows updated or deleted, or more than 20% of a collection of at least 5 rows, or past a rule's `maxChanged`;\n    - `key-lost`: a collection whose key the PR's rows no longer bear out, so its rows were compared without one, and updates read as deletes and inserts;\n    - `unverified`: a collection the PR pane's snapshot cut short where the base pane's didn't, or a cut-short one whose count changed. What happened past the cut can't be seen, so it is never taken for nothing;")
start = s.index("  - **Severity:** `amber` when the base made the same change, else `red`.")
end = s.index("\n", start)
s = s[:start] + ("  - **Severity:** `amber` when the base made the same change (`shared`) and `trusted` is `true`, else `red`. The same change means the same rows (by key, or as a multiset without one), with the same fields changed, the same field, or for two cut-short collections the same change in count. A count stands for rows only when both panes have only counts. Unless `trusted` is `true`, the base's changes excuse nothing, and every flag but `cleared` is `red`. A `cleared` field is `amber` at most. `allowDeletes` turns off a collection's `delete` flags, but not `emptied` or `key-lost`.") + s[end:]
open(p, 'w').write(s)

p = R + 'CHANGELOG.md'
s = open(p).read()
sub("  - **What a snapshot keeps:** each collection's rows, key and true count, at most 10,000 rows a collection and 32 MB in all.",
    "  - **What a snapshot keeps:** each collection's rows, key and true count, at most 10,000 rows a collection, 32 MB in all, shared fairly, and 1,000 collections.")
sub("    - which of the PR's changes are destructive: red unless the base made the same change (the same rows, the same field), then amber.",
    "    - which of the PR's changes are destructive: red unless the base made the same change (the same rows, the same fields), then amber. A collection a PR cut short where the base's wasn't is flagged `unverified`.")
open(p, 'w').write(s)
print('ok')
