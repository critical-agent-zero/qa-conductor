#!/bin/bash
# The starving shapes against a candidate fix (one queue by the whole rank)
D="$(cd "$(dirname "$0")" && pwd)"
cd "$D/probe"
N=/Users/mc/.nvm/versions/node/v24.14.0/bin/node
for a in "45 a 0" "5 a 40" "20 a 0"; do
  perl -e 'setpgrp(0,0); alarm 120; exec @ARGV' "$N" s2-wide-rows.mjs $a | grep -v "^    "
done
perl -e 'setpgrp(0,0); alarm 120; exec @ARGV' "$N" w2-judgment.mjs both 100 6
perl -e 'setpgrp(0,0); alarm 120; exec @ARGV' "$N" s1-flagged-padding.mjs 200 delete 32 a
