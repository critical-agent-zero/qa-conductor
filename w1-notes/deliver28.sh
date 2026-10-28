#!/bin/bash
# Pin the base, show the PR's own changes (three-dot), push agent/w1-issue-27 to the bot's fork (no force).
set -e
W=/private/tmp/claude-502/-Users-mc-Documents-GitHub-homefree--claude-worktrees-qa-conductor-stage05/013e4732-ceef-439a-94a4-f253ff944b6b/scratchpad/run/w1
R=$W/repo28
git -C "$R" fetch -q origin main
BASE=$(git -C "$R" rev-parse origin/main)
echo "pinned base: $BASE"
echo "--- diff --name-status $BASE...HEAD"
git -C "$R" diff --name-status "$BASE...HEAD"
echo "--- new commits"
git -C "$R" log --format='%h %G? %an <%ae> %s' fork/agent/w1-issue-27..HEAD
GIT_ASKPASS=$W/askpass.sh GIT_TERMINAL_PROMPT=0 git -C "$R" -c credential.helper= push https://critical-agent-zero@github.com/critical-agent-zero/qa-conductor.git agent/w1-issue-27:refs/heads/agent/w1-issue-27
