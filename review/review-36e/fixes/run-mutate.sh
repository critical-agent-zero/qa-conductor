#!/bin/bash
D="$(cd "$(dirname "$0")" && pwd)"
cd "$D/probe"
perl -e 'setpgrp(0,0); alarm 5400; exec @ARGV' /Users/mc/.nvm/versions/node/v24.14.0/bin/node mutate5.mjs "$@" > "$D/mutate5.out" 2>&1
echo "exit $?"
cmp "$D/mut/lib/data-capture.mjs" "$D/repo/lib/data-capture.mjs" && echo "mut lib identical to repo"
