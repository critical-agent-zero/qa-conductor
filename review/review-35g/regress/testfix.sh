D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/regress
rm -rf "$D/repofix"
mkdir -p "$D/repofix"
cp -R "$D/repo/lib" "$D/repo/test" "$D/repo/package.json" "$D/repo/README.md" "$D/repo/CHANGELOG.md" "$D/repofix/"
cp "$D/vfix/lib/data-diff.mjs" "$D/repofix/lib/data-diff.mjs"
cd "$D/repofix"
perl "$D/tmo.pl" 300 node --test --test-force-exit test/data-diff.test.mjs test/data-masking-corpus.test.mjs > "$D/out-testfix.txt" 2>&1
echo "exit $?" >> "$D/out-testfix.txt"
grep -E "^# (tests|pass|fail)|^not ok|^ℹ (tests|pass|fail)|✖" "$D/out-testfix.txt" | head -40
tail -3 "$D/out-testfix.txt"
