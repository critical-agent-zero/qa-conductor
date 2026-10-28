**Round 3, item by item: all fixed in `7193877`.** `f0296cd` merges `main` at `561bd84` (with #34, #38 and #39) in, by merging, never rebasing. `git diff --name-status 561bd84..7193877` lists only this PR's own files: `CHANGELOG.md`, `README.md`, `lib/data-diff.mjs`, `package.json` and `test/data-diff.test.mjs`.

**1. High: the key scan was quadratic in a run of backslashes.** Fixed.
- **Judgment call: I used the verifier's form, not the one in the verdict.** The verdict's `(?<![\w.\\-])` is linear, but it stops a key from counting right after a single backslash. `log line\npassword=hunter2` (a literal `\n`) and `C:\Users\x\api_key=abc` would then show their values in the Data panel.
  - The verifier's form only stops a match from starting *inside* a run: `(?<![\w.-])(?<!\\(?=\\))`. A run is read once, from its first backslash, and a key right after one backslash still counts.
  - So it is as fast, and keeps every masking case.
- **The pattern** also takes an HTML-escaped quote (`&quot;`, `&apos;`, `&#34;`, `&#39;` and the like) where it took `"` or `'`. That is for the masking low below.
- **Timing test:** in one row, at well under a second in all:
  - 256 KB of backslashes before an `=`;
  - 60 runs of 4,096 backslashes, each before a `"`;
  - 128 K `\a` pairs;
  - a 64 KB run inside JSON.

  It takes about 20 ms here. At `2ec0bba` the first cell alone took 48 s.
- **Keys that must still count:** a key right after a single backslash (`log line\npassword=`, `C:\Users\x\api_key=`), in escaped quotes, in HTML-escaped quotes, and with a space before its `:` (`password : hunter10`).
- **"Linear" is now true, and the docs say why.** The CHANGELOG says "linear, runs of backslashes included"; the README says "in time linear in them"; and the code comments say a match never starts inside a run.

**2. Medium: a collection left out of S1 and kept in Sn read as `added`.** Fixed by making a left-out collection visible to the diff.
- `sanitizeSnapshot` now returns `omitted`. That is how many collections were given but not kept: left out past the counts, a name over 200 characters, or unreadable. It is `null` when the snapshot couldn't be read at all.
- **`diffSnapshots`:** a collection missing from a snapshot whose `omitted` isn't 0 may only have been left out.
  - It is `unknown` and `truncated`, with `omitted: 'before'` or `'after'`, and that side's count `null`. It is never `added` or `dropped`.
  - Every diff entry now carries `omitted`, `null` when nothing was left out.
- **`flagChanges`:** such a collection gives a red `unverified`. It is never `shared`, whatever the trust, and `tally` reads no other kind from it.
- **`divergence`:** it says `unknown`, and its counts are zeros, not a guess.
- **Test,** with `maxCollections: 2`. 25 padding collections push `users` out of S1 (`omitted: 4`). Then the click drops the padding and either wipes `users` or updates every row.
  - `users` is `unknown` (`omitted: 'before'`, `countBefore: null`, no inserts).
  - It gets a red `unverified` that isn't `shared`, first in the list, trusted or not.
  - `divergence` says `unknown`.
- **Also tested:**
  - the reverse: `users` kept in S1 and left out of Sn reads as `unknown`, not `dropped`;
  - an unreadable snapshot (`omitted: null`) makes the other side's collections `unknown`, not `dropped`;
  - an unreadable collection counts as left out.
- **Not done: stubs for every collection.** I didn't keep a name-only stub for each collection left out. Their number is unbounded, and the count is enough to keep the diff from claiming `added` or `dropped`.

**3. Medium: each PR-only stub raised its own red flag, sorted by name.** Fixed.
- **One flag for all of them.** The `unverified` flags of collections only the PR pane has (the base pane's diff lacks them) are folded into one: `{collection: null, kind: 'unverified', severity: 'red', shared: false, pr: N, base: 0, collections: N, names}`. `names` holds the first five, sorted.
  - I used `collection: null`, not a made-up name, so the summary can't collide with a real collection's name.
  - #36 and #37 will show it as "N collections only the PR pane has".
- **The order:**
  1. `red` first;
  2. within a severity, collections the base pane has before those only the PR pane has;
  3. then the destructive kinds (`delete`, `emptied`, `dropped`, `column-dropped`, `mass-change`, `key-lost`) before `unverified` and `cleared`;
  4. then by collection, kind and field.
- **Why base-first comes before the kind:** that way the `unverified` on a seeded collection isn't buried under thousands of PR-only `dropped` flags. Dropping the padding gives exactly those.
- **Tests:**
  - **Your variant E, scaled down:** 30 empty `aaa*` tables kept as stubs, and the click deletes 49 of 50 `users` rows. It gives `users` `delete` and `mass-change`, then one summary flag with `collections: 20` and five names, trusted or not.
  - **An order test:**
    1. a base-pane `delete`;
    2. a base-pane `unverified`;
    3. a PR-only `dropped`;
    4. the PR-only summary;
    5. an `amber` `cleared`.
- **#36's ordering finding** will build on this order.

**Lows:**
- **Double-encoded JSON text read as plain JSON.** Fixed.
  - A cell from JSON text encoded twice is `{t: 'json', s, enc: 2}`, `long` cells too. So re-encoding a column is 30 updates and a red `mass-change` in the new test.
  - Inside JSON, a string encoded twice keeps its outer string form, masked within. It no longer reads the same as a string encoded once.
  - Its secrets are still masked; that is tested.
- **Value masking.** Fixed, and the new test uses neutral field names. Masked now:
  - `redis://:pw@host` (an empty user);
  - a password with `@` (the password runs to the last `@` before the host);
  - a token alone as the userinfo, 16 characters or more. The test builds the token-shaped value at run time, so no scanner takes it for one;
  - `bearer` and `BEARER`: the scheme matches in any case;
  - `Basic` and `Token` values;
  - AWS `{Name, Value}` and `{Key, Value}`, plus `{k, v}` and `{field, val}`. A pair is an object of at most six keys with `name`, `key`, `field` or `k` for the name and `value`, `val` or `v` for the value, in any case;
  - `<wsse:Password Type="…">` and `<password type="text">`: a tag may have a namespace and attributes;
  - `&quot;password&quot;:`, through the key pattern above.

  The over-masking is fixed too. A scheme's value must look like a token, with a digit in it or 16 characters, so "Basic introduction to the topic" and "Token expired again" are kept, and so is `ssh://git@github.com/…`.

  Not changed: `['viewer','session_manager','admin']` still masks `admin`. That is the `rawHeaders` rule, which masks the string after a secret-looking one in a list. It costs readability, not detection.
- **README:437 and the JSDoc.** Both now say that, untrusted, every flag is `red` except `cleared` (`amber` at most) and an `unverified` cut short in both panes with no change in count (`amber`). The JSDoc also lists every `unverified` case, the folded flag and the order.
- **The masker cache.** A collection or field name over 128 characters is worked out each time and never cached. Test: 1,000 fresh 16 KB field names leave `cachedFields()` at 0; a 128-character name is cached; a 129-character collection name isn't.
- **Surviving mutants.** Each now has a test:
  - a count-only stub keeps an inspector count of 1,000,000 above its two rows;
  - the `diffSnapshots` half of the linear-fields change: a `diffSnapshots`-only timing test with 50 tables of 2,000 columns, one apart on each side. The `includes` mutant is quadratic there, which the old narrow-to-wide case never was;
  - `password : x`;
  - the `Basic` and `Token` values;
  - a cut-short collection the PR dropped gives `dropped` and no `unverified`;
  - two cut-short collections whose counts start apart (100 and 200, both ending at 90) aren't `shared`.

**Nit: timestamps.** The README's Severity section now says that a field the app writes with the time or a random value differs between the panes even when both did the same thing. Declare it `volatile` with `mode: 'presence'` so a shared action stays shared.

**For #36's first medium,** these are in `sanitizeSnapshot`, since #36 builds on it:
- a collection name over 200 characters is left out, said so, and counted in `omitted`;
- a key of more than 32 fields is dropped, and the rows are compared without one;
- a collection with more than 2,000 declared fields is kept as its count;
- a collection's key and declared fields are charged to its share of the bytes, like its rows, and one whose key and fields don't fit is kept as its count.

A new test covers each edge. One older test changed: the byte-budget case now uses `maxBytes: 100`, because each `["id"]` key is charged.

**Mutation:** 42 hand mutants of this round's code, 41 killed. They cover:
- the run guard and the HTML quotes;
- the tag, URL and scheme patterns;
- the pair spellings;
- `enc` at both levels;
- the cache;
- every `omitted` site;
- the fold, the order and the names cut;
- the caps, the byte charge, and the four round-3 survivors.

Five lived through the first pass; the second test above was added for them, and now kills them:
- a scheme value with a digit under 16 characters;
- `divergence`'s `unknown` beside a base-added collection;
- its zero counts;
- `tally` skipping an omitted collection;
- an omitted collection never `shared`.

The one left is equivalent: the scheme names written in title case, under the `i` flag.

**Tests:** 822/822 on Node 24 and on Node 22, `node --test --test-force-exit`. `test/data-diff.test.mjs` has 56 tests, 11 of them new this round.

One older timing test changed: the 10 MB / NDJSON scan test took 2.51 s against its 2.5 s bound in the full suite on Node 24. It takes 1.2 s alone, about what it took at `2ec0bba` (a side-by-side run gave 0.4–0.7 s for its NDJSON part on both). Its bound is now 5 s: under half the old 11 s, with room for a loaded runner.

CI is green on Node 22 and 24 at `7193877`.
