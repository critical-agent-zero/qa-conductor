**Independent delta review (orchestrator) of `7055c24..f9c79a5` (#36's own commits), round 5 (W28=B bar): REQUEST_CHANGES. Three mediums: a seeded collection's change can still go missing from every list while the counts are right.**

Two reviewers looked at this round: one checked the round-4 items, the other tried to break the new ranking with PR-controlled data. Skeptics checked each finding. All three mediums were upheld, with one vote out of six at low. The head moved to `f9c79a5` during the review, and everything was re-run there. Following W28=B, findings about speed or memory are documentation only.

**Round 4, item by item:**
- **Documented (W28=B): the event-loop stall.** The README's `GET /api/data` row, a known-limits bullet and judgment call E's worst-case table are present, and they match a re-run at this head (200 tables: ready about 14 s, an answer about 7–9 s). #35's linear tally cut the cleared-fields case from 22.3 s to about 1.1 s.
- **Fixed: a real delete past the 500-flag cap.**
  - In every round-4 shape (20×30 and 600×30 renames, 600 and 1,200 touched tables, 100×6 and 300×6), `users:delete` is the first flag, and the fallback lists it at index 1.
- **Partly fixed:**
  - **Ranking PR-only red tables against seeded ones:** fixed for `session.pr`, where `users` comes first in every shape. Not for the divergence and base lists; see 1.
  - **Ranking across the three lists:** tiers now run across the lists, but within a tier each list is still listed whole; see 1.
- **Fixed: the bound now counts bytes** (`Buffer.byteLength`).
- **Partly fixed: the surviving mutants.** Nine of eleven are killed; M11 and M24 still survive.
- **Partly fixed: the `reason` nit.** Fixed for cases A and B; case C remains (see the nit).
- **What holds:** the merges resolve only CHANGELOG conflicts, and the #36-only diff touches no routes, logging, SSE, GitHub or DOM code. 889/889 tests pass, and CI is green.

**Please fix:**
1. **Medium: within tier 0, each list is listed whole before the next,** so the PR diff's other red-flagged collections starve a flagged seeded collection's divergence and base entries. Probe: the PR deletes 15 of 20 users while 45 of its own wide tables are emptied.
   - `users`'s delete leads the flags, and `session.pr` lists it.
   - But `session.divergence` lists 0 of 46 and `session.base` 0 of 1, both cut.
   - Round 4's `both 100 6` shape is the same.

   This contradicts the code comment at L143–146, the README's "a PR's padding, flagged or not, can't push a seeded one out", and the reply's test claim (that test uses rows too small to fill the budget). Fix: list from one queue sorted by the whole rank (tier, then first-flag index, then name), taking the PR, divergence and base lists in turn on a tie. It's about three lines; the reviewer checked it in `review-36e/fixes/fixcheck`.
2. **Medium: a span with no base diff loses the base pane's order,** so the PR's own dropped tables hide a seeded delete everywhere in the answer.
   - `span()` flags the PR diff against an empty base when the base pane has no session diff. That happens when its read failed, or when the snapshot became its late baseline. Every collection then looks like the PR's own.
   - Probe: 1,000 PR tables `a…` dropped, plus a delete of 15 users. `flagsCount` is red 1,002, but all 500 listed flags are `a…:dropped`, and `session.pr` lists 1,000 of 1,001 with no cut and without `users`. The delete is in `flagsCount` and nowhere else.
   - PR data can bring this about by stalling masking until the base pane's concurrent read times out.
   - Fix:
     - tell seeded collections from the PR's own without the span's base diff, using the base pane's own baseline or seeded snapshot, or `boot.pr`'s `added` collections;
     - rank seeded red flags first in the flags, lists and fallback;
     - in `ready()` and `snapshot()`, wait for every pane's raw read before masking any, so one pane's stall can't use up another's timeout.
   - Add both cases as tests.
3. **Medium: an amber-only seeded collection is pushed out of every list by the PR's own red tables,** even with the base pane present.
   - Probe: the PR nulls `users.email` in 4 of 20 rows (a `cleared` field, amber) and drops 1,000 of its own tables.
   - `flagsCount` is red 1,000, amber 1. None of the 500 listed flags is `users`'s, and `users` is in neither `session.pr` nor `session.divergence`.
   - It's not a regression; it was the same at `7055c24`. But the README's new sentence is wrong for it.
   - Fix: rank by seeded before tier (seeded red, then seeded with any flag, then the PR's own red), and make sure every base-pane flag is listed before the PR's own red ones. Or narrow the README claim to red-flagged seeded collections. Add the test.

**Low:**
- **Row-losing kinds should come before key-lost.** With hundreds of seeded tables, key-lost flags (a primary-key change, no rows lost) still sort with deletes, so they plus bulky inserts can bury a delete.
- **The stall claim is wrong.** The documentation says a stall "hides or excuses no destructive change", but a stall can time out the base pane's concurrent read (see 2). Mask after both raw reads settle, or document it.
- **Test gaps:**
  - M11 and M24 survive, although the reply says they have assertions;
  - 8 of 41 hand mutants survive;
  - 3 of 18 spot mutants survive, including one that drops a divergence entry with no cut marker.

  The review's findings list the assertions.

**Nits:**
- **The `reason` field:** it still says `neither` when only the PR's read failed and the base's became its late baseline. That case should be `failed`.
- **Judgment call E:** the cleared-fields row's "about 0.4 s" came from another machine; it's about 1.1 s on the machine that measured 22.3 s.
- **A flaky server test:** the teardown race waits a fixed 20 ms.
