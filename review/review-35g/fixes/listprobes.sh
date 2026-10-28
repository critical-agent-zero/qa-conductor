#!/bin/bash
cd /Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run
for d in review-35 review-35b review-35c review-35d review-35e review-35f; do
  echo "## $d"
  find $d -maxdepth 3 \( -name '*.mjs' -o -name '*.js' \) -not -path '*/repo/*' -not -path '*/main/*' -not -name 'data-diff*.mjs' | sort | tr '\n' ' '
  echo
done
