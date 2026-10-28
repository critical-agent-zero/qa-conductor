D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/regress
for s in 2ec0bba 7193877 4a284f9 4ed6449 4033285; do
  mkdir -p "$D/uncut/$s/lib"
  sed 's/^const MAX_TEXT = 200$/const MAX_TEXT = 1e9/' "$D/heads/$s/lib/data-diff.mjs" > "$D/uncut/$s/lib/data-diff.mjs"
  grep -c "MAX_TEXT = 1e9" "$D/uncut/$s/lib/data-diff.mjs"
done
