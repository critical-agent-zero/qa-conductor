#!/bin/bash
# The data-capture, session, server and demo tests against the candidate fix
D="$(cd "$(dirname "$0")" && pwd)"
cd "$D/repo"
perl -e 'setpgrp(0,0); alarm 600; exec @ARGV' /Users/mc/.nvm/versions/node/v24.14.0/bin/node --test --test-force-exit --test-concurrency=2 test/data-capture.test.mjs test/session.test.mjs test/server.test.mjs test/demo.test.mjs > "$D/tests.out" 2>&1
echo "exit $?"
grep -E "^ℹ (tests|pass|fail)|^✖" "$D/tests.out" | head -20
