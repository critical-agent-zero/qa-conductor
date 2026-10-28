#!/bin/bash
# usage: wait-checks.sh <sha>  -- waits until every upstream check run on <sha> has completed; prints each conclusion
SHA=$1
for i in $(seq 1 120); do
  LEFT=$(gh api "repos/critical-labs/qa-conductor/commits/$SHA/check-runs" --jq '[.check_runs[] | select(.status != "completed")] | length' 2>/dev/null)
  ALL=$(gh api "repos/critical-labs/qa-conductor/commits/$SHA/check-runs" --jq ".check_runs | length" 2>/dev/null)
  if [ "$LEFT" = "0" ] && [ "${ALL:-0}" -ge 3 ]; then
    gh api "repos/critical-labs/qa-conductor/commits/$SHA/check-runs" --jq '.check_runs[] | "\(.name): \(.conclusion)"'
    exit 0
  fi
  sleep 30
done
echo "still running"
