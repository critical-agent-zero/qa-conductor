#!/bin/bash
# w-judgment shapes from round 4 (the first medium), at the current head
D="$(cd "$(dirname "$0")" && pwd)"
for a in "rename 20 30" "touch 600" "both 100 6" "rename 20 20" "touch 400" "rename 600 30" "both 300 6" "touch 1200"; do
  bash "$D/run-probe.sh" w2-judgment.mjs $a
done
