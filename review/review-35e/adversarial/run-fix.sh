D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/adversarial
cd $D
sed 's#./new/data-diff.mjs#./fix/data-diff.mjs#' fuzz-mask.mjs > fuzz-fix.mjs
sed 's#./new/data-diff.mjs#./fix/data-diff.mjs#' probe-corpus.mjs > probe-corpus-fix.mjs
: > out-fuzzfix.txt
for args in "30000 1" "40000 11 notaglt pct" "40000 7 notaglt" "40000 23"; do
  bash pgrun.sh 600 out-fuzzfix-one.txt node fuzz-fix.mjs $args 2>/dev/null
  cat out-fuzzfix-one.txt >> out-fuzzfix.txt
done
grep -E '^N=' out-fuzzfix.txt
bash pgrun.sh 300 out-corpus-fix.txt node probe-corpus-fix.mjs 2>/dev/null
grep -E 'REGRESSION|tag_attr|pct_|^\{' out-corpus-fix.txt
