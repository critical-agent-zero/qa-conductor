#!/bin/bash
# usage: watch-ci-sha.sh <full sha>  -- polls the commit's check-runs every 20s (up to 30 min)
# until test (22) and test (24) both exist and are completed; prints every run's conclusion.
SHA="$1"
for i in $(seq 1 90); do
  DONE=$(gh api "repos/critical-labs/qa-conductor/commits/$SHA/check-runs" --jq '[.check_runs[] | select(.name == "test (22)" or .name == "test (24)") | select(.status == "completed")] | length' 2>/dev/null)
  if [ "${DONE:-0}" -ge 2 ]; then
    echo "after $i polls:"
    gh api "repos/critical-labs/qa-conductor/commits/$SHA/check-runs" --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion) \(.html_url)"'
    exit 0
  fi
  sleep 20
done
echo "timed out after 30 min"
exit 1
