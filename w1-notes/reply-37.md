**Round 3, item by item: all fixed in `e0b635c`.** `d4ee418` merges #36's round 4 (`7055c24`, which carries #35's round 3 and `main` at `561bd84`) in, by merging, never rebasing. `git diff --name-status 561bd84..e0b635c` lists only #35's, #36's and this PR's files.

**1. Medium: "Nothing to compare yet" after a snapshot when neither pane could be read.** Fixed at the source and in the harness.
- **In #36's view:** once a run has happened, a span with neither pane's data is `{complete: false, base: null, pr: null, divergence: null, flags: [{kind: 'unreadable', reason: 'neither'}], flagsCount: {red: 1}}`, not `null`. That covers the session span after a Snapshot now, and the boot span after ready.
- **In the harness:**
  - It draws the red line "Neither pane could be read for this span, so the PR pane's changes are unknown.", and the badge counts it.
  - An answer that still has no session span once `comparedAt` is set is drawn and counted the same way.
  - "Nothing to compare yet" is only for before the first snapshot.
  - The boot span's text before ready now reads "No boot span yet: the panes' ready snapshots haven't been taken."
- **Test, through the real capture:**
  - The PR deletes 15 of 20 users, and the badge reads 2.
  - Then both probes hang (`timeoutMs: 20`) and Snapshot now runs again. The badge is 1, the panel draws the "Neither pane" line, and never "Nothing to compare yet".
  - Both ready reads failing gives badge 1 and the same line for the boot span, on mount.

**2. Medium: the collections table was an alphabetical slice of 300.** Fixed.
- **The order:** `spanCollections` puts collections with a red flag first, then any that changed or are `unknown` (any status but `same`), then the rest, each in name order. #36's answer also lists collections ranked this way now.
- **"and N more collections"** uses the view's `collectionsCount`, so 1,501 collections with 300 drawn say "and 1201 more".
- **Fields dropped and added** end in ", and N more", from `counts.fieldsDropped` and `counts.fieldsAdded`.
- **Tests:**
  - 301 unchanged collections that sort before a changed `users`: `users` is drawn first;
  - `collectionsCount: 1501`;
  - 60 dropped fields with 50 listed: ", and 10 more";
  - the existing 300-collection test now checks the 20 red-flagged ones come first.

**Low:**
- **The Re-baseline sentence** is drawn for the session span only. On the boot span it reads "The boot span stays as it was: a Re-baseline aligns only the session span." Tested both ways.
- **A late PR baseline.** #36's flag now says why the PR pane has no diff (`reason`: `failed`, `neither` or `baseline`). For `baseline`:
  - the flag reads "The PR pane's baseline is this snapshot: take another to see its changes.";
  - the incomplete line reads "Incomplete: the PR pane's baseline is this snapshot, so it has no changes to show yet.";
  - nothing says "couldn't be read".

  I keyed it on #36's `reason` rather than on `baselines.pr === comparedAt`, which the capture now gives directly.

**Nits:**
- **N19:** a list whose flags are all drawn has no "and … more flags". Asserted.
- **N10:** the cut-digest test has the 8-hex tail `[text with a secret-looking key, 40 characters, 1a2b3c4d`, which `{0,7}` would leave showing.
- **N6:** equal per-pane baselines draw "baseline HH:MM:SS". Asserted.

**New in #35's and #36's answers, drawn here too:**
- **One flag for many collections:**
  - "20 collections only the PR pane has: unverified …, such as aaa01, aaa02";
  - for #36's fold, "10 more collections: unverified …, such as …".
- **An answer too big to list:** the span says "This span's details were too big to list: its counts and first red flags are below, and nothing else." It draws its flags and no table, and no "has no data" line.
- **A collection a snapshot may have left out:** its status reads "unknown (left out of a snapshot)", and a count that isn't one shows as `?`. A count that isn't an integer is drawn as `?` everywhere now, so a control inside one never reaches the page. The hostile-answer test checks that.
- **Problems:** at most 20 a pane are drawn, then "and N more problems", from `problemsCount`.

**Mutation:** 20 hand mutants of this round's harness code, all killed. They cover:
- the null-span badge and line;
- the ranking, by red flag and by status;
- the whole counts for collections and for fields;
- the Re-baseline sentence;
- the baseline line and the flag reasons;
- the one-for-many flag text and its fold;
- the unlisted span;
- the left-out status and `?`;
- the problems cap and its count;
- N19, N10 and N6.

**Tests:** 901/901 on Node 24 and on Node 22, `node --test --test-force-exit`. `test/harness.test.mjs` has 65 tests, 5 of them new this round. CI is green on Node 22 and 24 at `e0b635c`.
