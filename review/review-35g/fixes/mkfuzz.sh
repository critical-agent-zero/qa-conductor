#!/bin/bash
# Make copies of the earlier rounds' fuzzers that compare old heads (env O1,
# O2) with 4033285.
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes
cd $D
sed -e "s/M\['7193877'\]/M[process.env.O1 ?? '7193877']/g" -e "s/M\['4a284f9'\]/M[process.env.O2 ?? '4a284f9']/g" -e "s/M\['4ed6449'\]/M['4033285']/g" p35f/fuzz.mjs > fuzz.mjs
sed -e "s/M\['7193877'\]/M[process.env.O1 ?? '7193877']/g" -e "s/M\['4a284f9'\]/M[process.env.O2 ?? '4a284f9']/g" -e "s/M\['4ed6449'\]/M['4033285']/g" p35f/fuzz-keys.mjs > fuzz-keys.mjs
sed -e "s/M\['4a284f9'\]/M[process.env.O1 ?? '4a284f9']/g" -e "s/M\['4ed6449'\]/M['4033285']/g" p35f/fuzz-values.mjs > fuzz-values.mjs
sed -e "s#^import \* as NEW from './new/data-diff.mjs'#import * as NEW from './v4033285/data-diff.mjs'#" -e "s#^import \* as OLD from './old/data-diff.mjs'#const OLD = await import(\`./v\${process.env.O1 ?? '4a284f9'}/data-diff.mjs\`)#" p35e/fuzz-mask.mjs > fuzz-mask.mjs
grep -n "M\[\|import" fuzz.mjs fuzz-keys.mjs fuzz-values.mjs fuzz-mask.mjs | grep -v '^.*://' | head -30
