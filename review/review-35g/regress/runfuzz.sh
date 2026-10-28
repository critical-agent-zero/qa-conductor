D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/regress
cd "$D"
# usage: bash runfuzz.sh "seed:count:mode ..."
for spec in $1; do
  IFS=: read seed count mode <<< "$spec"
  ( perl "$D/tmo.pl" 1500 node fuzz.mjs "$seed" "$count" "$mode" > "$D/sum-$mode-$seed.json" 2>&1 ) &
done
wait
for spec in $1; do
  IFS=: read seed count mode <<< "$spec"
  echo "== $mode $seed"; cat "$D/sum-$mode-$seed.json"
done
