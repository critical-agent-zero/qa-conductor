#!/bin/bash
# Main-thread CPU beside wall time for the round-4 cost shapes
D="$(cd "$(dirname "$0")" && pwd)"
echo "load: $(uptime)"
bash "$D/run-probe.sh" cpu-cost.mjs cleared 100
bash "$D/run-probe.sh" cpu-cost.mjs wide-seeded
echo "load: $(uptime)"
bash "$D/run-probe.sh" cpu-cost.mjs wide-own
bash "$D/run-probe.sh" cpu-cost.mjs rows 200
echo "load: $(uptime)"
