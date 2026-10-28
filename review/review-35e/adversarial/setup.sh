set -e
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/adversarial
cd $D/repo
node --version
grep -n '"test"' package.json
mkdir -p $D/old $D/new
git show 7193877:lib/data-diff.mjs > $D/old/data-diff.mjs
cp lib/data-diff.mjs $D/new/data-diff.mjs
git rev-parse HEAD
uptime
