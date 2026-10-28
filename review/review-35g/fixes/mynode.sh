#!/bin/bash
# lists (and with -k kills) node processes whose cwd or args are under this review directory
for p in $(pgrep node); do
  c=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-)
  a=$(ps -o command= -p $p 2>/dev/null)
  case "$c $a" in *review-35g/fixes*) echo "mine: $p $c $(echo $a | cut -c1-140)"; [ "$1" = "-k" ] && kill -KILL $p;; esac
done
echo "checked $(pgrep node | wc -l) node processes"
