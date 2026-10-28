#!/bin/bash
# the head's capture and engine, a copy the mutation run can't touch
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/adversarial
mkdir -p "$D/cur/lib" "$D/cur/probe"
cd "$D/repo" || exit 1
git show 2b8379d:lib/data-capture.mjs > "$D/cur/lib/data-capture.mjs"
git show 2b8379d:lib/data-diff.mjs > "$D/cur/lib/data-diff.mjs"
ls -la "$D/cur/lib"
