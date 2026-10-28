D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/adversarial
cd $D/repo
git show 7193877:test/data-diff.test.mjs > $D/old/data-diff.test.mjs
cd $D
P=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35d
bash pgrun.sh 600 out-literals.txt node probe-literals.mjs repo/test/data-diff.test.mjs old/data-diff.test.mjs probe-corpus.mjs fuzz-mask.mjs $P/fixes/probe-d2.mjs $P/fixes/probe-d7.mjs $P/adversarial/probe-mask.mjs $P/adversarial/probe-names.mjs $P/adversarial/probe-re.mjs repo/README.md 2>/dev/null
tail -c 6000 out-literals.txt
