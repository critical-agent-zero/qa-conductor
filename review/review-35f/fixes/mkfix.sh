#!/bin/bash
# fix/: head with the DSN password class allowing ':' again ([^\s/]), to check
# that the DSN-with-':' shapes are masked and the head's tests still pass
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/fixes
mkdir -p $D/fix/lib $D/fix/test
cp $D/repo/package.json $D/fix/package.json
cp $D/repo/test/data-diff.test.mjs $D/fix/test/data-diff.test.mjs
FROM='const DSN_USERINFO = /(?<![\w.-])([\w.-]{1,64}):([^\s/:]{1,256})@'
TO='const DSN_USERINFO = /(?<![\w.-])([\w.-]{1,64}):([^\s/]{1,256})@'
node -e '
const fs = require("fs")
const [src, out, from, to] = process.argv.slice(1)
const s = fs.readFileSync(src, "utf8")
if (s.split(from).length !== 2) throw new Error("not found once")
fs.writeFileSync(out, s.replace(from, () => to))
' $D/repo/lib/data-diff.mjs $D/fix/lib/data-diff.mjs "$FROM" "$TO"
diff $D/repo/lib/data-diff.mjs $D/fix/lib/data-diff.mjs
