#!/bin/bash
# Lists node processes whose working directory is inside this review's dir
for p in $(pgrep node); do
  c=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-)
  case "$c" in *review-36e*) echo "$p $c";; esac
done
echo checked
