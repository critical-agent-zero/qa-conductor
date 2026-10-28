D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/regress
cd $D/repo
for s in 2ec0bba 7193877 4a284f9 4ed6449 4033285; do
  mkdir -p $D/heads/$s/lib
  git show $s:lib/data-diff.mjs > $D/heads/$s/lib/data-diff.mjs
  wc -l $D/heads/$s/lib/data-diff.mjs
  grep -n "^import" $D/heads/$s/lib/data-diff.mjs
done
ls $D/repo $D/repo/lib $D/repo/test
cat $D/repo/package.json
git log --oneline 2ec0bba -1
