D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/adversarial
cd $D/repo
bash $D/pgrun.sh 1500 $D/test-out.txt node --test --test-force-exit test/*.test.mjs
tail -30 $D/test-out.txt
