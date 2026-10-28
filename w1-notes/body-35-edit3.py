import json
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
s = open(N + 'body-35-live3.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:80], s.count(a))
    s = s.replace(a, b, 1)


sub("`git diff --name-status 561bd84..4ed6449` lists only this PR's 5 files.", "`git diff --name-status 561bd84..4033285` lists only this PR's 6 files.")
sub("Round 5 (comment 6346159710) is answered item by item in comment 6346432155, in `4ed6449`.",
    "Round 5 (comment 6346159710) is answered item by item in comment 6346432155, in `4ed6449`. Round 6 (comment 6347232740) is answered item by item in comment 6347508056, in `4033285`.")
sub("  - **Round 5:** a key right after a percent-escape counts again, and a tag is read by its name alone, so a `<` in an attribute can't hide it (both regressions of round 4). The pair rule takes any name-like key, and a row shaped as a pair is masked. Go DSNs up to their last `@`, any network; attribute values quoted either way or not.",
    """  - **Round 5:** a key right after a percent-escape counts again, and a tag is read by its name alone, so a `<` in an attribute can't hide it (both regressions of round 4). The pair rule takes any name-like key, and a row shaped as a pair is masked. Go DSNs up to their last `@`, any network; attribute values quoted either way or not.
  - **Round 6:**
    - a DSN password holding `:` is masked again;
    - the text rules run in the order URL, scheme, element, DSN, JWT, so a DSN can't run past a secret element's `>`;
    - a scheme's word that isn't a token no longer hides the next scheme.
- **P. A masking regression corpus** (round 6). `test/data-masking-corpus.test.mjs` is one table of every shape a review round has reported, 257 values and rows, and each must stay masked. The shapes no head masks yet are its known misses, named in the README. Before a masking change, the reviewers' differential fuzz is run against the earlier heads: for `4033285`, 0 regressions against 7193877, 4a284f9 and 4ed6449.""")
sub("- **Tests:** 837 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). 71 are in `test/data-diff.test.mjs`, all new.",
    "- **Tests:** 841 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). 73 are in `test/data-diff.test.mjs` and 2 in `test/data-masking-corpus.test.mjs`, all new.")
sub("22 hand mutants of its changes, 19 killed; the other three are equivalent or cost only time.",
    "22 hand mutants of its changes, 19 killed; the other three are equivalent or cost only time.\n- **Round 6** (two high regressions, lows) is answered in `4033285`, item by item in comment 6347508056. 8 hand mutants of its changes, all killed, and the corpus.")
json.dump({'body': s}, open(N + 'body-35-new3.json', 'w'))
print('ok')
