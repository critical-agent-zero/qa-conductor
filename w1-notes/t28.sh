#!/bin/bash
# usage: t28.sh <22|24|file> [file]  -- runs the full suite (no file) or one test file in repo28 on Node 22 or 24.
cd /private/tmp/claude-502/-Users-mc-Documents-GitHub-homefree--claude-worktrees-qa-conductor-stage05/013e4732-ceef-439a-94a4-f253ff944b6b/scratchpad/run/w1/repo28 || exit 1
if [ "$1" = "22" ]; then export PATH=/Users/mc/.nvm/versions/node/v22.20.0/bin:$PATH; fi
node --version
if [ -n "$2" ]; then
  node --test "$2" 2>&1 | grep -E "^✖|^not ok|(ℹ|#) (tests|pass|fail) |AssertionError|Error \[" | head -30
else
  npm test 2>&1 | grep -E "(ℹ|#) (tests|pass|fail) |^✖|^not ok" | head -20
fi
