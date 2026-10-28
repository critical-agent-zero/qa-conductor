import json
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
s = open(N + 'body-35-live.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""`git diff --name-status 561bd84..7193877` lists only this PR's 5 files. Round 3 (comment 6198758245) is answered item by item in comment 6339977511, in `7193877`.""",
    """`git diff --name-status 561bd84..4a284f9` lists only this PR's 5 files. Round 3 (comment 6198758245) is answered item by item in comment 6339977511, in `7193877`. Round 4 (comment 6341513501) is answered item by item in comment 6345595506, in `4a284f9`, under the owner's decision W28=B (N).""")
sub("""  - **Caps, for #36:** a collection name over 200 characters is left out. A key of more than 32 fields is dropped. More than 2,000 declared fields, or a key and fields over the collection's share of the bytes, keep it as a count. The key and fields are charged to its bytes.""",
    """  - **Caps, for #36:** a collection name over 200 characters is left out. A key of more than 32 fields is dropped. More than 2,000 declared fields, or a key and fields over the collection's share of the bytes, keep it as a count. The key and fields are charged to its bytes.
  - **Names left out for their length don't count in `omitted`** (round 4): no name the diff sees can be one of them, so they can't turn a certain drop into `unverified`. Collections left out past the counts keep no name-to-count stub (N): such a wipe stays a red `unverified`.""")
sub("""  - **The order:** `red` first. Within a severity, the base pane's collections come before those only the PR pane has, then the destructive kinds before `unverified` and `cleared`, then the name.
  - **Why base-first leads:** padding the PR drops can't bury a seeded collection's flag in a capped list.
  - **One flag:** the `unverified` flags of collections only the PR pane has are folded into one, `collection: null`, with how many and the first five names.""",
    """  - **The order:** `red` first. Within a severity, the base pane's collections come before those only the PR pane has. Then the kinds that lose data (`delete`, `emptied`, `dropped`, `key-lost`), then `column-dropped` and `mass-change`, then `unverified` and `cleared` (round 4). Then the name.
  - **Why base-first leads:** padding the PR drops can't bury a seeded collection's flag in a capped list.
  - **One flag:** the `unverified` flags of collections only the PR pane has are folded into one, `collection: null`, with how many and the first five names. A collection's dropped columns are one flag too, with `count` and the first five `fields` (round 4), so renamed columns can't push a delete out.""")
sub("""- **I. The design's thresholds, as written.**""",
    """- **N. Hostile PR data: slowdowns and heap growth are documented, not engineered away** (owner decision W28=B, round 4).
  - The engine runs on the conductor's event loop. PR-controlled data within the limits can stall the panes for seconds, and for minutes in the worst shapes measured (about 4 minutes for 32 MB of lines that look like JSON).
  - Masking works through the raw data a PR's store holds, and the 32 MB budget counts the kept rows' JSON, not heap: 29 MB of `{}` rows took about 600 MB.
  - This is accepted because PR authors have passed the trust gate. A stall shows no masked value and hides no destructive change.
  - The README states it under Known limits, "Hostile PR data and the conductor's responsiveness".
  - Only what shows a secret or hides a destructive change is fixed. The one performance fix kept is the tag pattern, a round-3 regression. The quadratic `tally()` merge is linear too, since it was a one-line fix.
- **O. Masking is best-effort, and says what it misses** (round 4).
  - **Masked:** the pair rule takes `name` or `key` with `value` (lower case or capitalized) at any size, and the looser spellings only up to 6 keys. Every value key is masked.
  - **Masked in text:**
    - backtick, percent-encoded and any-case entity quotes;
    - secret-named flags, a MySQL client's `-p`, and PEM keys;
    - a token as a URL's user, base64 `Basic` values, Go DSN passwords, JWTs, and the value of an element named as a secret.
  - **Names:** `pw`, `psk` and `auth`.
  - **Not `key` alone,** which is often a row's own key.
  - **The rest is listed in the README:** SQL `INSERT … VALUES` by position, a password alone on a line, and the like.
- **I. The design's thresholds, as written.**""")
sub("""  - `flagChanges`: `delete` (soft deletes too), `emptied`, `dropped`, `column-dropped` (per field), `mass-change` and `cleared` (per field), red or amber as above;""",
    """  - `flagChanges`: `delete` (soft deletes too), `emptied`, `dropped`, `column-dropped` (per collection, with `count` and `fields`), `mass-change` and `cleared` (per field), red or amber as above;""")
sub("""- **Tests:** 822 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). 56 are in `test/data-diff.test.mjs`, all new.""",
    """- **Tests:** 831 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). 65 are in `test/data-diff.test.mjs`, all new.""")
sub("""- **Round 3** (one high, two medium, lows) is answered in `7193877`, item by item in comment 6339977511. 42 hand mutants of its changes: 41 killed, and one equivalent (the scheme names in title case, under the `i` flag).""",
    """- **Round 3** (one high, two medium, lows) is answered in `7193877`, item by item in comment 6339977511. 42 hand mutants of its changes: 41 killed, and one equivalent (the scheme names in title case, under the `i` flag).
- **Round 4** (two high, four medium, lows) is answered in `4a284f9`, item by item in comment 6345595506. Under W28=B the work and heap items are documented, not fixed (N). 35 hand mutants of its changes, all killed but one whose code turned out redundant and was removed.""")
json.dump({'body': s}, open(N + 'body-35-new.json', 'w'))
print('ok')
