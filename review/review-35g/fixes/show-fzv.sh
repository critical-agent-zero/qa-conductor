#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes/fzv
grep -v '^\[h' $D/url-elem.txt
for f in $D/fuzzvalues-*.txt $D/fuzzmask-*.txt; do
  echo "## $(basename $f)"
  grep -v '^\[h' $f | cut -c1-300
done
