#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes
bash $D/test.sh 22.20.0 $D/test-22-dd.txt test/data-diff.test.mjs test/data-masking-corpus.test.mjs
bash $D/test.sh 22.20.0 $D/test-22-server.txt test/server.test.mjs
bash $D/test.sh 22.20.0 $D/test-22b.txt
