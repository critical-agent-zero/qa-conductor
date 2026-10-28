#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes/fz2
for f in $D/fv-*.txt; do
  n=$(head -1 $f | sed -E 's/.*regressions ([0-9]+).*/\1/')
  [ "$n" = "0" ] && continue
  echo "## $(basename $f)"
  sed -n '2,200p' $f | grep -v '^exit' | cut -c1-260
done
