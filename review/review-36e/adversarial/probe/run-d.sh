#!/bin/bash
P=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/adversarial/probe
cd "$P" || exit 1
run() { perl -e 'setpgrp(0,0); alarm shift; exec @ARGV' 300 node d-key-lost-cover.mjs "$@"; }
run 600 12
run 600 0
run 400 12
