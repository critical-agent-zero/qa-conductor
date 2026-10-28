#!/bin/bash
# s1 (flagged padding) and s2 (wide rows) shapes from round 4 (the second medium and the starving low)
D="$(cd "$(dirname "$0")" && pwd)"
for a in "1000 drop 1 a" "1000 drop 1 z" "999 drop 1 a" "1000 delete 1 a" "300 drop 32 a" "200 delete 32 a" "1000 same 32 a"; do
  bash "$D/run-probe.sh" s1-flagged-padding.mjs $a
done
for a in "5 a 40" "6 a 0" "45 a 0" "10 a 0" "20 a 0" "45 z 0"; do
  bash "$D/run-probe.sh" s2-wide-rows.mjs $a
done
