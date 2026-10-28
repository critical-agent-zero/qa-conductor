D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/regress
cd "$D"
mkdir -p "$D/fixrun"
export HEADS=2ec0bba,7193877,4a284f9,4ed6449,4033285,vfix
export NEW=vfix
for spec in $1; do
  IFS=: read seed count mode <<< "$spec"
  ( perl "$D/tmo.pl" 1500 node fuzz.mjs "$seed" "$count" "$mode" "$D/fixrun/out-$mode-$seed.jsonl" > "$D/fixrun/sum-$mode-$seed.json" 2>&1 ) &
done
wait
for spec in $1; do
  IFS=: read seed count mode <<< "$spec"
  echo "== $mode $seed"; grep -E '"(cases|regress|regressMask)"' "$D/fixrun/sum-$mode-$seed.json"; grep -A8 '"byOld"' "$D/fixrun/sum-$mode-$seed.json" | head -8
done
