#!/bin/bash
P=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/adversarial/probe
cd "$P" || exit 1
run() { perl -e 'setpgrp(0,0); alarm shift; exec @ARGV' 300 node a-base-null.mjs "$@"; }
run 1000 control drop a
run 1000 now-fail drop a
run 1000 late-base drop a
run 1000 now-fail drop z
run 600 now-fail drop a
run 120 now-fail fat a
run 120 late-base fat a
run 120 control fat a
