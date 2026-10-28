#!/bin/bash
# to.sh SECONDS cmd... : run cmd in its own process group; kill the whole group after SECONDS
secs=$1; shift
set -m
"$@" &
pid=$!
( sleep "$secs"; kill -TERM -"$pid" 2>/dev/null; sleep 3; kill -KILL -"$pid" 2>/dev/null ) &
watch=$!
wait "$pid"
rc=$?
kill "$watch" 2>/dev/null
pkill -P "$watch" sleep 2>/dev/null
# make sure the group is gone
kill -KILL -"$pid" 2>/dev/null
exit $rc
