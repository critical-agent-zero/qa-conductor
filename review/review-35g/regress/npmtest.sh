D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/regress
cd $D/repo
node --version
perl $D/tmo.pl 900 node --test --test-force-exit test/*.test.mjs > $D/npmtest.log 2>&1
echo "exit $?" >> $D/npmtest.log
tail -15 $D/npmtest.log
