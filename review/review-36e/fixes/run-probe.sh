#!/bin/bash
# usage: bash run-probe.sh probe.mjs [args...]  (runs from probe/, 300 s alarm, own process group)
D="$(cd "$(dirname "$0")" && pwd)"
cd "$D/probe"
NODE=${NODE:-/Users/mc/.nvm/versions/node/v24.14.0/bin/node}
perl -e 'setpgrp(0,0); alarm 300; exec @ARGV' "$NODE" --max-old-space-size=8000 "$@" 2>&1
echo "[exit $?]"
