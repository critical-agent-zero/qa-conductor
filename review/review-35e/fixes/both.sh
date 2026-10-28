#!/bin/bash
# full suite on Node 24 then Node 22, then the data-diff timing tests alone 3x on each
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/fixes
echo "load before: $(uptime)"
bash $D/test.sh 24.14.0 $D/test-24b.txt > /dev/null
echo "node 24: $(grep -E 'ℹ (tests|pass|fail) ' $D/test-24b.txt | tr '\n' ' ') $(grep -E '^✖ ' $D/test-24b.txt | sort -u | cut -c1-90 | tr '\n' ';')"
bash $D/test.sh 22.20.0 $D/test-22b.txt > /dev/null
echo "node 22: $(grep -E '^# (tests|pass|fail) ' $D/test-22b.txt | tr '\n' ' ') $(grep -E '^not ok' $D/test-22b.txt | cut -c1-90 | tr '\n' ';')"
for V in 24.14.0 22.20.0; do
  for i in 1 2 3; do
    cd $D/repo
    perl -e 'setpgrp(0,0); $pid=fork; if(!$pid){exec @ARGV} $SIG{ALRM}=sub{kill -9, -$$; exit 124}; alarm 300; waitpid($pid,0); exit($?>>8)' /Users/mc/.nvm/versions/node/v$V/bin/node --test-name-pattern='is linear' --test --test-force-exit --test-reporter=spec test/data-diff.test.mjs > $D/timing-$V-$i.txt 2>&1
    echo "timing $V run $i: exit $? $(grep -E '^ℹ (pass|fail) ' $D/timing-$V-$i.txt | tr '\n' ' ') $(grep -oE '^[✔✖] .{0,40}.*\(([0-9.]+)ms\)' $D/timing-$V-$i.txt | sed -E 's/^([✔✖]) (.{0,40}).*\(([0-9]+)\.[0-9]+ms\)/\1 \2.. \3ms/' | tr '\n' ';')"
  done
done
echo "load after: $(uptime)"
