**Round 3, item by item: all fixed in `7055c24`.** `875cc7b` merges #35's round 3 (`7193877`, which carries `main` at `561bd84`) in, by merging, never rebasing. `git diff --name-status 561bd84..7055c24` lists only #35's and this PR's own files.

**1. Medium: the bound didn't charge each collection's name or `key`.** Fixed in both PRs.
- **Here, every entry is charged.** Each listed collection's entry counts against the span's budget: its name, and its fields but the lists (`key` among them), plus room for its `counts`. The divergence's entries are charged the same way.
- **The listing stops when the budget runs out.** That diff, or divergence, then says `cut: true`, beside its whole `collectionsCount`.
- **The order within a span:**
  1. the flags;
  2. the PR pane's diff;
  3. the divergence;
  4. the base pane's diff.

  So if a span runs short, it is the base pane's listing that gives way.
- **An answer still too big to build is built again without its lists.** Each span then has:
  - `unlisted: true`, and no `base`, `pr` or `divergence`;
  - a red `{kind: 'unlisted'}` flag, then its first 20 red flags;
  - `flagsCount`, which counts the `unlisted` flag too.

  `errors`, `baselines` and the rest stay. So the badge still counts, and the first flags still show. Only if that build fails too is the failure cached, as before.
- **In #35's `sanitizeSnapshot`** (round 3 there):
  - a collection name over 200 characters is left out, said so, and counted in the snapshot's `omitted`;
  - a key of more than 32 fields is dropped, and the rows are compared without one;
  - a collection with more than 2,000 declared fields, or whose key and fields don't fit its share of the bytes, is kept as its count;
  - the key and the declared fields are charged to the collection's bytes.

  So a `key` here is at most 32 names of at most 200 characters, and I didn't add a separate `keyCount` cut: a key never reaches the 50-item cap.
- **Two more lists I found unbounded:**
  - a pane's `problems`: now at most 50, with `problemsCount`. 11,000 unreadable collections gave 11,000 lines;
  - an error's text: now cut at 500 characters. An inspector's error can carry what the database said.
- **The real bound:** about 4 MB. 1,000 collections of 20 wide rows rewritten twice, 5.6 MB at `a2bbc7c`, is now 3.99 MB, built in 0.47 s. Each span's lists and entries share 2 MB, and `problems` and `errors` are small. The README row, the CHANGELOG and this PR's body now say so, not "about 6 MB".
- **Tests:**
  - **Wide keys:** the PR's migration adds 1,000 empty tables with 32-field keys of 200-character names, the most #35 lets through. The answer is under 4.5 MB, `boot.pr` lists fewer than 1,000 with `collectionsCount: 1000`, and it says `cut: true`.
  - **Past the caps:** a 2,000-field key and a 2,000-character name only show in `problems`.
  - **The fallback,** with `JSON.stringify` failing for any answer with lists: it gives `unlisted: true`, the red `unlisted` flag first, then `users`' `delete` and `emptied`, `flagsCount {red: 3}`, and `errors` intact.
  - **The cached failure** is built twice (with lists, then without) and then not again.

**2. Medium: the caps sorted by name, so padding pushed the real delete out.** Fixed.
- **The flags.** #35 now orders red flags with the base pane's collections first and the destructive kinds before `unverified` within them. It also folds the `unverified` flags of collections only the PR pane has into one. Here, the list keeps that order, red first.
  - Past 20 red `unverified` flags of named collections, the rest become one flag in their place: `{collection: null, kind: 'unverified', folded: true, collections, names}`.
  - **Judgment call:** I kept the engine's order instead of strictly "every non-`unverified` red flag first". Dropping the padding gives thousands of red `dropped` flags for collections only the PR has. Strict ordering would put those ahead of a seeded collection's `unverified`: #35's left-out-and-wiped case, where `users` is `unverified` and the padding is `dropped`. In the engine's order, the base pane's collections come first, and within them `delete` and the like come before `unverified`. So in your probe `users`' `delete` and `mass-change` lead.
- **`chosen()` ranks the collections,** then sorts by name:
  1. a red flag;
  2. changed rows (rows, fields or the key);
  3. an amber flag;
  4. any other change, such as empty `added` tables and count-only stubs;
  5. no change.

  The divergence ranks the same way.
- **Tests:**
  - **Your probe:** the PR deletes 15 of 20 users and adds 10,999 empty tables named `a00000`… The boot span's first two flags are `users`' `delete` and `mass-change`, and the third is the one PR-only `unverified` with `collections: 10000`. `flagsCount` is `{red: 3}`, and `users` is in `boot.pr` (15 deleted), `boot.base` and `boot.divergence`.
  - **The fold:** 30 collections cut short in the PR pane only list 20 by name, then one folded flag with `collections: 10` and the next five names.
  - **The ranking:** 1,051 collections, where both panes insert into 1,050 `a…` and delete from `zz`. `zz` is listed first, of the 1,000 listed.

**Lows:**
- **Both ready reads failing made the boot span aligned.** Fixed.
  - A boot span is aligned only when both panes' baselines came from the ready read itself: `bootRun.base === readyRun && bootRun.pr === readyRun`.
  - `baselineAt` is set only when a pane settled at ready.
  - **Test:** both ready reads fail, the PR's migration emptied the carts, and the base empties them before the first Snapshot now. Isolated, the boot span is `aligned: false`, and its `delete` and `emptied` are red. `baselineAt` stays `null`, and `baselines` are equal.
- **A span with neither pane was `null` after a snapshot.** Fixed. Once a run has happened, such a span is `{complete: false, base: null, pr: null, divergence: null, flags: [{kind: 'unreadable', reason: 'neither'}], flagsCount: {red: 1}}`.
  - This covers a boot span whose panes both failed to open, after ready, and a session span whose reads both hang.
  - **Test:** both probes hang at Snapshot now (`timeoutMs: 20`).
  - The `unreadable` flag now always says why: `failed`, `neither` or `baseline` (the nit below).
- **Untested mutants.** Each now has a test:
  - a divergence collection with 120 changes lists 50 with `changesCount: 120` (R19 and N40; R20, N41 and N12);
  - a divergence the budget cut says `cut: true` (N11);
  - with `viewBytes: 40000`, a span's flags, diffs and divergence together stay within 20,000 characters, plus a little JSON scaffolding (N42, N17);
  - 300 red flags are listed in part within the span's share, and the PR diff then says `cut: true` (N15);
  - a late pane's boot span from a Re-baseline is `aligned: false` (N38).

**Nit: a late PR baseline read as an unreadable PR pane.** Fixed.
- The session span's flag is now `{kind: 'unreadable', reason: 'baseline'}`. It is still red: there is nothing to compare yet, so the PR's changes are unknown. #37 will say "The PR pane's baseline is this snapshot: take another to see its changes".
- When the late baseline comes, `errors.boot` replaces "its baseline will be its first later snapshot" with "its baseline is the snapshot at <ISO time>".
- **Test:** the existing late-PR test now checks both, and that the next snapshot compares.

**Mutation:** 29 hand mutants of this round's code, all killed. They cover:
- the entry charge;
- the stop and its `cut`;
- the fallback, its count and its flags;
- the error and problems cuts;
- the ranking;
- the fold, its place and its names;
- the order of the span's lists;
- the boot alignment and `baselineAt`;
- the non-null span and each `reason`;
- the late-baseline wording;
- the divergence's cut and count;
- the budget's halves.

Two lived through the first pass, and a test was added for each:
- ranking an amber flag with a red one: 1,050 collections cut short alike in both panes can't push out one whose rows changed;
- the fold appended at the end rather than in place: a PR-only `dropped` after the folded flags stays after the fold.

**Tests:** 866/866 on Node 24 and on Node 22, `node --test --test-force-exit`. `test/data-capture.test.mjs` has 32 tests, 10 of them new this round.

One unrelated flake: a first Node 22 run failed `the default clock is monotonic` in `test/action-log.test.mjs`. That is #34's test, on `main`, with a 5 ms bound under full-suite load. It passed 3 of 3 alone, and the full suite passed on the rerun.

CI is green on Node 22 and 24 at `7055c24`.
