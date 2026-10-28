#!/bin/bash
# The round-4 cost probes at the current head (W28=B: documented, so compare with judgment call E's table)
D="$(cd "$(dirname "$0")" && pwd)"
echo "load: $(uptime)"
echo "== x-cleared 10000 100"; bash "$D/run-probe.sh" x-cleared.mjs 10000 100
echo "== x-cleared 10000 20"; bash "$D/run-probe.sh" x-cleared.mjs 10000 20
echo "== x-cleared 10000 40"; bash "$D/run-probe.sh" x-cleared.mjs 10000 40
echo "load: $(uptime)"
echo "== x-wide-cost own"; bash "$D/run-probe.sh" x-wide-cost.mjs own
echo "== x-wide-cost seeded"; bash "$D/run-probe.sh" x-wide-cost.mjs seeded
echo "load: $(uptime)"
echo "== t-cost 100 10000 update"; bash "$D/run-probe.sh" t-cost.mjs 100 10000 update
echo "== t-cost 200 10000 update"; bash "$D/run-probe.sh" t-cost.mjs 200 10000 update
echo "load: $(uptime)"
