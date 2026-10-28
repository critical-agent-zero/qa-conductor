#!/bin/bash
# lists node processes whose cwd is under this review directory
for p in $(pgrep node); do
  c=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-)
  case "$c" in *review-35e*) echo "mine: $p $c $(ps -o command= -p $p | cut -c1-120)";; esac
done
echo "checked $(pgrep node | wc -l) node processes"
