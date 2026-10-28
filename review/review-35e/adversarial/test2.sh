D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/adversarial
cd $D/repo
uptime
bash $D/pgrun.sh 1500 $D/test-out2.txt node --test --test-force-exit test/*.test.mjs 2>/dev/null
grep -E '^ℹ (tests|pass|fail)|^✖' $D/test-out2.txt
tail -1 $D/test-out2.txt
uptime
