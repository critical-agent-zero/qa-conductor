#!/bin/bash
# the round-4 head's capture and engine, for comparison
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/adversarial
mkdir -p "$D/old/lib"
cd "$D/repo" || exit 1
git show 7055c24:lib/data-capture.mjs > "$D/old/lib/data-capture.mjs"
git show 7055c24:lib/data-diff.mjs > "$D/old/lib/data-diff.mjs"
mkdir -p "$D/old/probe"
sed 's#\.\./repo/lib/#../lib/#' "$D/probe/a-base-null.mjs" > "$D/old/probe/a-base-null.mjs"
ls -la "$D/old/lib" "$D/old/probe"
