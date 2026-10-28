#!/bin/bash
# Were the surviving mutants' shapes ever reported (probe files or findings)?
R=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run
cd $R
for pat in 'mongodb+srv' '+srv://' 'postgresql+' 'HTTPS://' 'POSTGRES://' '--PASSWORD' '--TOKEN' 'app-user:' 'my-user:' 'eyJ[A-Za-z0-9_]*\.eyJ[A-Za-z0-9_]*\.[A-Za-z0-9_]*-' 'pa>ss' ; do
  n=$(grep -rlF -- "$pat" review-35c review-35d review-35e review-35f --include='*.mjs' --include='*.json' --include='*.md' --include='*.txt' 2>/dev/null | grep -v '/repo/' | grep -v '/main/' | grep -v fixtree | head -5 | tr '\n' ' ')
  echo "[$pat] $n"
done
grep -rhoE '"[a-z0-9+]+\+[a-z0-9+]*://[^"`]{0,60}' review-35c review-35d review-35e review-35f --include='*.mjs' 2>/dev/null | grep -v node_modules | sort -u | head
