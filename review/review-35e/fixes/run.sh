#!/bin/bash
# usage: run.sh <timeout-seconds> <outfile> <node args...>
# runs node (v24) in its own process group; on timeout the whole group is killed
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/fixes
cd $D
T=$1; OUT=$2; shift 2
NODE=${NODE:-/Users/mc/.nvm/versions/node/v24.14.0/bin/node}
perl -e 'setpgrp(0,0); $pid=fork; if(!$pid){exec @ARGV} $SIG{ALRM}=sub{print STDERR "TIMEOUT\n"; kill -9, -$$; exit 124}; alarm '"$T"'; waitpid($pid,0); exit($?>>8)' $NODE "$@" > $OUT 2>&1
echo "exit=$?" >> $OUT
cat $OUT
