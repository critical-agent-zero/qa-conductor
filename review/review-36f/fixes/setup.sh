#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36f/fixes
sed -i '' "s#'./repo/lib/#'../repo/lib/#" "$D/probe/vf-wide.mjs"
grep -n "^import\|harness37" "$D"/probe/*.mjs
sed -n 30,200p "$D/probe/vf-wide.mjs"
