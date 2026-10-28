#!/bin/bash
P=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/adversarial/probe
cd "$P" || exit 1
run() { perl -e 'setpgrp(0,0); alarm shift; exec @ARGV' 400 node b-stall-times-out-base.mjs "$@"; }
# control: no stall
run 2000 0 1000
# a small stall past a 2 s timeout
run 2000 8 1000
# a small stall within it
run 2000 1 1000
