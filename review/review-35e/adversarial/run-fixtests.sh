D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/adversarial
cd $D
bash pgrun.sh 300 out-tagtime.txt node probe-tagtime.mjs 2>/dev/null
cat out-tagtime.txt
cd $D/fixrepo
bash $D/pgrun.sh 900 $D/out-fixtests.txt node --test --test-force-exit test/data-diff.test.mjs 2>/dev/null
grep -E '^ℹ (tests|pass|fail)|^✖' $D/out-fixtests.txt
cd $D/repo
bash $D/pgrun.sh 900 $D/out-headtests.txt node --test --test-force-exit test/data-diff.test.mjs 2>/dev/null
grep -E '^ℹ (tests|pass|fail)|^✖' $D/out-headtests.txt
uptime
