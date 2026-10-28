**Round 5, item by item: in `46d0197`,** one commit on `feb0d43`, which merges #35's round 6 (`4033285`) into `f9c79a5`. `git diff --name-status 4033285..46d0197` lists only this PR's files.

**1. Medium: within a tier, each list was listed whole.** Fixed as you proposed.
- **The queue:** the three lists are listed from one queue, sorted by the whole rank (tier, then first-flag index, then name), with the PR diff, the divergence and the base diff in turn on a tie.
- **The cut marker:** a list says `cut` exactly when it stopped before its end. The `stopped &&` guard was redundant once there was one queue, so it is gone.
- **Tests:**
  - **Your probe:** the PR deletes 15 of 20 users while 45 of its own tables (50 rows of 200 characters each) are emptied, with a budget those rows overrun. `users` is listed in `session.pr`, `session.divergence` and `session.base`. The PR diff is cut, and the base diff, which listed everything, is not.
  - **The same shape with the 45 wide tables seeded:** they are named `z00`… so they sort after `users`, and all of them are in the first tier. `users` is the first entry of all three lists. Without the whole rank, the PR diff's tier-0 entries used the budget up first.
- **The comment and the README:** both now describe the one queue.

**2. Medium: a span with no base diff lost the base pane's order.** Fixed, all three parts.
- **Telling seeded from own:** `ownOf` uses the span's base diff when there is one. Without one, it uses the base pane's newest snapshot (its latest, baseline or seeded). Without that, it uses the collections the PR pane's boot added.
- **Seeded red flags first:** they rank first in the flags, the lists and the fallback. `inAnswerOrder` sorts all three.
- **Raw reads first:** `ready()` and `snapshot()` now wait for every pane's raw read (`takeAll`) and only then mask.
- **Tests, four shapes:**
  - the base pane's read failed;
  - the same, with the PR's 1,000 tables older than its seed, so its boot span doesn't show them added;
  - the base pane's read became its late baseline;
  - the base pane was never read.

  In each, the PR drops 1,000 of its own tables and deletes 15 users. `flagsCount.red` is 1,002, `users:delete` is the first flag, `users` is first in `session.pr`, and the fallback lists it at index 1.
- **The stall test:** the PR's raw snapshot takes 1.5 s to mask, the base pane's read answers after 100 ms as I/O would, and the timeout is 1 s. The base pane's read stands, for `ready` and for `snapshot`.

**3. Medium: an amber-only seeded collection was pushed out.** Fixed by your first option.
- **Collections rank seeded before tier.** In order:
  1. seeded with a red flag;
  2. seeded with changed rows;
  3. seeded with any flag;
  4. the PR's own with a red flag;
  5. then the rest as before.
- **Flags:** every flag of a seeded collection, amber ones too, is listed before the PR's own red ones. `listedFlags` keeps the answer's order instead of moving every amber flag to the end.
- **Test, your probe:** 4 of 20 emails are nulled and 1,000 of the PR's tables are dropped, with a budget those tables overrun.
  - `flagsCount` is `{red: 1000, amber: 1}`.
  - The amber `users:cleared` is the first flag.
  - `users` is first in `session.pr` and `session.divergence`, and `session.base` lists it while the PR diff is cut.

**Low, row-losing before key-lost.** Fixed in the answer's order. Among each group's flags:
1. what loses rows: deletes, emptying, drops, and a seeded collection the PR's snapshots left out or cut short where the base pane's didn't;
2. a lost key;
3. the rest.

Each keeps the engine's order within it. #35's engine order still groups `key-lost` with deletes; the answer refines it, and the `GET /api/data` row says so.
- **Tests:**
  - 30 seeded tables lose their key beside a `users` delete: `users:delete` is first;
  - a seeded `zz` cut short only in the PR pane (`unverified`) comes before `aa:key-lost`.

**Low, the stall claim.** Fixed rather than documented: masking now runs only after both raw reads settle (2). Known limits gains a bullet saying so, and the "hides no destructive change" sentence is now true for this case.

**Low, test gaps.** All of your named survivors are covered:

| Mutant | Result |
|---|---|
| **M11** | Killed. A span with 2 red and 2 amber flags lists only `[unlisted, own:delete]` in its fallback. |
| **M24** | Killed. A base-pane collection whose key alone was lost ranks before a seeded amber-only one. |
| **N4, N7, N23**, and your spot mutants (a) skip-not-stop, (b) the divergence entry uncharged, (c) cut on every list | Killed by a budget sweep: 30 collections with long and short names in turn, at 450 budgets from 2 KB to 34 KB. At every budget, each list is a prefix of its order, it is cut exactly when short, and the span stays within its share plus 500 bytes. |
| **N12** | Killed. Equal ranks list by name in the same test. |
| **N15** | Split in two. The seeded amber tier is killed (3). The PR-own amber tier survives as **equivalent**: an own collection's only possible amber flag is `cleared`, and its rows changed, so it already ranks as changed rows. |
| **N24** | Moot. The condition it removed is gone: `cut` is now `done < todo.length`. |

- **This round's code:** 14 more hand mutants, all killed:
  - the queue, each list whole;
  - the queue by tier only;
  - each of the three seeded tells, and own-for-all;
  - amber after every red;
  - seeded amber dropped;
  - owned ignored;
  - key-lost with row-losing;
  - no groups;
  - left-out not row-losing;
  - masking as each read lands;
  - the reason by base diff;
  - the session's fresh base unpassed.

**Nits:**
- **The `reason` field:** cases C and D now say `failed`. `span()` takes whether the base pane was read for the span, not whether it has a diff. There is a test for both.
- **Judgment call E:** the cleared-fields row now says about 1.1 s, measured on the machine that measured 22.3 s.
- **The flaky server test:** the fixed 20 ms wait is gone. The test now waits on a deferred that resolves inside the inspector's held snapshot.

**Tests:** 900 passed and 0 failed on Node 24 and on Node 22 (`node --test --test-force-exit`); 47 are in `data-capture`. CI is green on `46d0197`.
