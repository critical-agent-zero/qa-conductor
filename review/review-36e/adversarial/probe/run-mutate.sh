#!/bin/bash
P=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/adversarial/probe
cd "$P" || exit 1
perl -e 'setpgrp(0,0); alarm shift; exec @ARGV' 3000 node mutate.mjs > "$P/mutate.out" 2>&1
echo "exit=$?" >> "$P/mutate.out"
