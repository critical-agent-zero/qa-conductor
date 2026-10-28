#!/bin/bash
P=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/adversarial/probe
cd "$P" || exit 1
run() { perl -e 'setpgrp(0,0); alarm shift; exec @ARGV' 300 node c-amber-seeded.mjs "$@"; }
run 0 drop 4 a
run 1000 drop 4 a
run 499 drop 4 a
run 600 drop 4 a
run 300 fat 4 a
run 1000 drop 4 z
