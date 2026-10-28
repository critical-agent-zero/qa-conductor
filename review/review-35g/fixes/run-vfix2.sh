#!/bin/bash
# Check vfix2 (scheme -> element -> URL -> DSN -> JWT) against every head:
# the PR's corpus, the probes, the fuzzers; then the PR's own tests.
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes
cd $D
export VARIANT=$D/vfix2/data-diff.mjs
mkdir -p fzv
r() { local out=$1; shift; bash $D/pgrun.sh 900 "$D/fzv/$out" "$@" 2>/dev/null; grep -v '^\[h.mjs\]' "$D/fzv/$out" | head -1; }
r corpus-heads.txt node corpus-heads.mjs
grep -E 'regressions|NEW-HEAD' $D/fzv/corpus-heads.txt
r url-elem.txt node probe-url-elem.mjs
grep -c CLEAR $D/fzv/url-elem.txt
for pair in "7193877 4a284f9" "4ed6449 2ec0bba"; do
  set -- $pair
  for s in 1 7 11; do r "fuzz-$1-$2-s$s.txt" env O1=$1 O2=$2 node fuzz.mjs 40000 $s all; done
  r "fuzz-$1-$2-html.txt" env O1=$1 O2=$2 node fuzz.mjs 20000 5 html
  for s in 1; do r "fuzzkeys-$1-$2-s$s.txt" env O1=$1 O2=$2 node fuzz-keys.mjs 100000 $s; done
done
for o in 4a284f9 4ed6449 7193877; do
  for s in 3 9; do r "fuzzvalues-$o-s$s.txt" env O1=$o node fuzz-values.mjs 40000 $s; done
  for s in 1 7; do r "fuzzmask-$o-s$s.txt" env O1=$o node fuzz-mask.mjs 30000 $s; done
done
# the PR's tests against vfix2
rm -rf $D/vfix2repo; mkdir -p $D/vfix2repo/lib $D/vfix2repo/test
cp $D/vfix2/data-diff.mjs $D/vfix2repo/lib/data-diff.mjs
cp $D/repo/test/data-diff.test.mjs $D/repo/test/data-masking-corpus.test.mjs $D/vfix2repo/test/
cd $D/vfix2repo
bash $D/pgrun.sh 300 $D/fzv/tests.txt node --test --test-force-exit test/data-diff.test.mjs test/data-masking-corpus.test.mjs 2>/dev/null
grep -E '^ℹ (tests|pass|fail)|^not ok|^# (tests|pass|fail)' $D/fzv/tests.txt
echo done
