#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/fixes
E=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e
mkdir -p $D/head $D/probes
cp $D/repo/lib/data-diff.mjs $D/head/data-diff.mjs
cd $D/probes
# probe-regress3: 2ec0bba / 7193877 / 4a284f9 / head
sed -e "s#'../../review-35d/fixes/old2ec/data-diff.mjs'#'../old2ec/data-diff.mjs'#" \
    -e "s#'./old/data-diff.mjs'#'../old79/data-diff.mjs'#" \
    -e "s#'./new/data-diff.mjs'#'../old4a/data-diff.mjs'#" \
    -e "s#'./fix/data-diff.mjs'#'../head/data-diff.mjs'#" \
    -e "s#'fix': FIX#'4ed6449': FIX#" \
    $E/adversarial/probe-regress3.mjs > probe-regress3.mjs
# fuzz-mask: OLD=env BASE (default 7193877), NEW=head
sed -e "s#import \* as NEW from './new/data-diff.mjs'#const NEW = await import('../head/data-diff.mjs')#" \
    -e "s#import \* as OLD from './old/data-diff.mjs'#const OLD = await import(process.env.BASE === '4a' ? '../old4a/data-diff.mjs' : '../old79/data-diff.mjs')#" \
    $E/adversarial/fuzz-mask.mjs > fuzz-mask.mjs
sed -e "s#import \* as NEW from './new/data-diff.mjs'#const NEW = await import('../head/data-diff.mjs')#" \
    -e "s#import \* as OLD from './old/data-diff.mjs'#const OLD = await import(process.env.BASE === '4a' ? '../old4a/data-diff.mjs' : '../old79/data-diff.mjs')#" \
    $E/adversarial/probe-corpus.mjs > probe-corpus.mjs
sed -e "s#import \* as NEW from './new/data-diff.mjs'#const NEW = await import('../head/data-diff.mjs')#" \
    -e "s#import \* as OLD from './old/data-diff.mjs'#const OLD = await import(process.env.BASE === '4a' ? '../old4a/data-diff.mjs' : '../old79/data-diff.mjs')#" \
    $E/adversarial/probe-flags.mjs > probe-flags.mjs
sed -e "s#import \* as NEW from './repo/lib/data-diff.mjs'#const NEW = await import('../head/data-diff.mjs')#" \
    -e "s#import \* as OLD from './old79/data-diff.mjs'#const OLD = await import(process.env.BASE === '4a' ? '../old4a/data-diff.mjs' : '../old79/data-diff.mjs')#" \
    $E/fixes/probe-mask.mjs > probe-mask.mjs
for f in probe-fold probe-words probe-mutcols probe-cpu probe-re probe-limit; do
  cp $E/fixes/$f.mjs $f.orig.mjs
done
cp $E/adversarial/probe-newpaths.mjs probe-newpaths.orig.mjs
cp $E/adversarial/probe-tagtime.mjs probe-tagtime.orig.mjs
head -5 *.mjs | grep -n import
grep -n "import" probe-*.orig.mjs | head -30
