**Merged #35's round 5 in: `f9c79a5`.**
- `1b89efc` merges `4ed6449` (#35's round 5), by merging, never rebasing.
- `f9c79a5` keeps the engine's new `fieldsBefore` (each diff entry's before-snapshot declared fields, which `flagChanges` uses to name seeded dropped columns first) out of the answer: up to 2,000 names a collection that no view draws. A test checks that.
- Nothing else in this PR changed. Round 4's answer (comment 6346159242) stands.
- `git diff --name-status 4ed6449..f9c79a5` lists only this PR's own files.
- **Tests:** 889 passed and 0 failed on Node 24 and on Node 22, and CI is green.
