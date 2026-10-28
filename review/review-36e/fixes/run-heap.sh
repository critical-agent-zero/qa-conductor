#!/bin/bash
# The wide-seeded shape at the default heap and at smaller heaps (a smaller host)
D="$(cd "$(dirname "$0")" && pwd)"
cd "$D/probe"
N=/Users/mc/.nvm/versions/node/v24.14.0/bin/node
for h in default 2048 1024; do
  echo "== heap $h: wide-seeded"
  if [ "$h" = default ]; then
    perl -e 'setpgrp(0,0); alarm 300; exec @ARGV' "$N" heap-wide.mjs wide-seeded 2>&1 | grep -v "^    at \|^$" | tail -12
  else
    perl -e 'setpgrp(0,0); alarm 300; exec @ARGV' "$N" --max-old-space-size=$h heap-wide.mjs wide-seeded 2>&1 | grep -v "^    at \|^$" | tail -12
  fi
  echo "[exit ${PIPESTATUS[0]}]"
done
