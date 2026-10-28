import json
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
s = open(N + 'body-35-live2.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:80], s.count(a))
    s = s.replace(a, b, 1)


sub("`git diff --name-status 561bd84..4a284f9` lists only this PR's 5 files.", "`git diff --name-status 561bd84..4ed6449` lists only this PR's 5 files.")
sub("in `4a284f9`, under the owner's decision W28=B (N).", "in `4a284f9`, under the owner's decision W28=B (N). Round 5 (comment 6346159710) is answered item by item in comment 6346432155, in `4ed6449`.")
sub("Then the kinds that lose data (`delete`, `emptied`, `dropped`, `key-lost`), then `column-dropped` and `mass-change`, then `unverified` and `cleared` (round 4).",
    "Then what loses rows, a collection or its key (`delete`, `emptied`, `dropped`, `key-lost`, and the `unverified` flag of a collection the PR's snapshots may have left out, round 5), then `column-dropped` and `mass-change`, then other `unverified` flags and `cleared` (round 4).")
sub("A collection's dropped columns are one flag too, with `count` and the first five `fields` (round 4), so renamed columns can't push a delete out.",
    "A collection's dropped columns are one flag too, with `count` and the first five `fields` (round 4), so renamed columns can't push a delete out. Its `fields` name the seeded columns first, with their count in `seeded` (round 5), so padding columns can't hide a seeded one; diff entries carry `fieldsBefore` for that.")
sub("  - **Names:** `pw`, `psk` and `auth`.",
    "  - **Names:** `pw`, `psk` and `auth`, after an escape too (round 5).\n  - **Round 5:** a key right after a percent-escape counts again, and a tag is read by its name alone, so a `<` in an attribute can't hide it (both regressions of round 4). The pair rule takes any name-like key, and a row shaped as a pair is masked. Go DSNs up to their last `@`, any network; attribute values quoted either way or not.")
sub("  - `flagChanges`: `delete` (soft deletes too), `emptied`, `dropped`, `column-dropped` (per collection, with `count` and `fields`),",
    "  - `flagChanges`: `delete` (soft deletes too), `emptied`, `dropped`, `column-dropped` (per collection, with `count`, `seeded` and `fields`),")
sub("- **Tests:** 831 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). 65 are in `test/data-diff.test.mjs`, all new.",
    "- **Tests:** 837 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). 71 are in `test/data-diff.test.mjs`, all new.")
sub("35 hand mutants of its changes, all killed but one whose code turned out redundant and was removed.",
    "35 hand mutants of its changes, all killed but one whose code turned out redundant and was removed.\n- **Round 5** (two high regressions, one medium, lows) is answered in `4ed6449`, item by item in comment 6346432155. 22 hand mutants of its changes, 19 killed; the other three are equivalent or cost only time.")
json.dump({'body': s}, open(N + 'body-35-new2.json', 'w'))
print('ok')
