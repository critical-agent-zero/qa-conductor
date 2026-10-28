**Round 4, item by item, under the owner's decision W28=B: in `4a284f9`.** It is one commit on `7193877`. `main` is still `561bd84`, and `git diff --name-status 561bd84..4a284f9` lists only this PR's own files: `CHANGELOG.md`, `README.md`, `lib/data-diff.mjs`, `package.json` and `test/data-diff.test.mjs`.

**The new bar (W28=B).** Slowdowns and memory growth caused by hostile PR data are accepted and documented, not engineered away. Only these are fixed:
- (a) what shows a secret or a classified value in clear;
- (b) what hides a destructive PR change, or makes it look benign or excused.

So the two highs and mediums about work and heap (2 and 6) are documented rather than fixed. The one exception is the tag pattern (1): it is a regression from round 3, with a one-line fix that was already verified. The README has a new limit under Known limits, "Hostile PR data and the conductor's responsiveness":
- the engine runs on the conductor's event loop;
- PR-controlled data within the limits can stall the panes, the harness and every request for seconds, and for minutes in the worst shapes measured;
- masking works through the raw data a PR's store holds;
- the 32 MB budget counts the kept rows' JSON, not the heap they take;
- it is accepted because PR authors have passed the trust gate, and a stall shows no masked value and hides no destructive change.

**1. High: `TAG_IN_TEXT` read attributes across the next `<`.** Fixed as proposed: `(?:\s[^<>]{0,256})?>`.
- **Timing test:** 20 cells of 256 KB of `<a ` and 4 of `<a:a `. They take about 0.5 s here, under a bound of 1.5 s; with `[^>]` they took over 3 s.
- A cell of `<a b="1" ` is read too.
- Tags with a namespace or attributes are still masked: `<wsse:Password Type="PasswordText">` and `<token kind="a">`.
- The mutant putting `[^>]` back is killed.

**2. High: masking work scales with the PR's raw bytes.** W28=B: documented, not fixed.
- No digest or parse budget, no bracket precheck in `heldJson`, and no first-line rule for NDJSON. The README's new limit states it, with the worst shape measured (about 4 minutes for 32 MB of lines that look like JSON).
- None of this shows a secret: past any such budget, the proposal would have masked more, not less.

**3. Medium: `column-dropped` was one flag per field.** Fixed: one flag a collection.
- The flag is `{kind: 'column-dropped', count, fields}`: how many declared fields went, and the first five by name. `pr` is the count too.
- It is `shared`, so `amber` when trusted, only when the base dropped every one of them.
- **Test, the review's shape:** 1,600 columns added to a seeded `accounts` and dropped at the click, beside a wipe of `users`. `users`'s delete is among the first 10 flags, and the list has 4 flags in all: `accounts` has one, with `count: 1600` and its first five fields.
- **The order (from #36's round 4, in this engine):**
  - within a severity, the base pane's collections still come first;
  - then the kinds that lose data (`delete`, `emptied`, `dropped`, `key-lost`);
  - then `column-dropped` and `mass-change`;
  - then `unverified` and `cleared`.

  A test checks 20 earlier-named tables, each with 30 renamed columns, beside a `users` delete: the delete comes first.
- **Also from #36's round 4:** `tally()` merged each flag's items with a spread copy, which was quadratic in a field's rows: 10,000 rows with 40 fields cleared took over 20 s to flag. It merges in place now, and the test bounds it at 3 s (about 0.1 s here).

**4. Medium: the pair rule's regression.** Fixed as proposed.
- **`name` or `key` with `value`, all lower case or all capitalized, is a pair whatever else the object holds.** That covers a HAR cookie (8 keys), an SSM Parameter (7), and `{name: 'DB_PASSWORD', value, …5 more}`.
- **The looser spellings** (`field`, `k`, `val`, `v`, mixed case) still need an object of at most 6 keys.
- **Every value key is masked,** so `{name: 'password', value, v}` shows neither.
- **Tests:**
  - an 8-key HAR cookie, an SSM Parameter, a 7-key pair, and one with two value keys: no value shows;
  - a loose spelling at 6 keys is masked, and at 7 it isn't;
  - a name that isn't a string isn't a pair;
  - a null value is kept as it is, so clearing one shows.

**5. Medium: one left-out collection turned a certain drop into `unverified`.** The cheap part is fixed, as you suggested.
- **Names over 200 characters no longer count toward `omitted`.** No name the diff sees can be one of them, so they can't make another collection "maybe left out".
- **Test:** a 201-character collection beside a drop of `users` gives `users` `dropped`, red, with divergence `pr-only`.
- **W28=B: documented, not fixed: name-to-count stubs for collections left out past the counts.**
  - With 11,000 empty PR tables, a wipe of `users` is still a red `unverified` rather than `delete`, `emptied` and `mass-change`.
  - It stays red, at the top of the base pane's flags. So nothing reads as benign, which is the line W28=B draws.

**6. Medium: the budget counts JSON bytes, not heap.** W28=B: documented, not fixed. The README's new limit says so, with your measure: 1,000 collections of 10,000 `{}` rows, 29 MB of JSON, took about 600 MB of heap for one snapshot, and the data answer keeps several.

**Low, the 16 surviving mutants.** Each now has a test:
- **QUOTE's `\\*` cut to `\\?`:** JSON text encoded three times, alone and inside text. Its secret never shows, and the mutant is killed.
- **Entity forms:** keys in `&apos;`, `&#x27;`, `&QUOT;` and `&#X22;` quotes are masked. Entities match in any case now; that is also the value residual below.
- **`enc`:**
  - a double-encoded cell over 200 characters keeps `enc: 2`;
  - an object and its JSON text give equal cells.
- **The pair bounds:**
  - 7 keys with a loose spelling;
  - any number of keys with a strict one;
  - a name that isn't a string;
  - a null value;
  - two value keys.
- **`omitted`:**
  - a `collections` object whose keys throw gives `omitted: null`;
  - divergence says `unknown` for a collection the base side may have left out.
- **The order:** `cleared` sorts after a shared delete and after a shared mass change, both `amber`, even where its collection's name sorts first.
- **The byte budget:**
  - a key alone over the share is kept as its count;
  - a count-only collection costs no bytes, so the next one keeps its share.
- **The userinfo threshold:** a token alone is masked from 16 characters, not 15.

**Low, value residuals.** Fixed, each with a test:
- **A token as a URL's user:**
  - `https://<token>:x-oauth-basic@github.com/…` and `https://<token>:@…` mask the user;
  - so does any user with an empty password or `x-oauth-basic`, and a user that looks like a token (a known prefix, or 16 characters with a digit) whatever its password;
  - a plain user (`app:pw@`) is kept, with its password masked.
- **A short base64 `Basic` value:** `Basic dXNlcjpwYXNz` is masked again, since a `Basic` value of base64 shape now counts as a token. "Basic introduction" and "Basic Introduction" are kept.
- **Upper-case entities:** `&QUOT;` and `&#X22;` count, as above.
- **A second value key in a pair:** every value key is masked (4).

**Low, secret shapes under neutral field names.** The cheap ones are fixed; the rest are listed in the README:
- **Fixed in text:**
  - backtick-quoted keys (the MySQL general log, Markdown);
  - up to 32 spaces before `=` or `:` (aligned config);
  - percent-encoded keys, quotes and separators (`password%3D…`, `%22password%22%3A…`);
  - `--password …` and `--db-token=…`, a flag whose name looks secret;
  - a MySQL client's `-p<password>` (`mysql`, `mysqldump`, `mysqladmin`, `mariadb`). A bare `-p` elsewhere, as in `mkdir -p` or `gcc -pthread`, is left be;
  - a PEM private key, masked whole;
  - a JWT, replaced by a digest;
  - a Go DSN's password (`user:<secret>@tcp(…)`);
  - the `value` of an element whose `key`, `name`, `id` or `type` looks secret (`<add key="DbPassword" value="…"/>`, `<input type="password" value="…">`).
- **Fixed in `SECRET_NAME`:**
  - `pw` and `psk` as words of their own (`pw`, `user_pw`, `wifi-psk`);
  - `auth` and `_auth` as the whole name (Docker's and npm's base64 `user:password`).

  `author`, `auth_provider` and `pwr` don't match.
- **Not added: `key` alone.** It is often a row's own key or a cache key, and masking it would hide what the diff compares. The README says to name such a field in `classify`.
- **Listed in the README as known gaps, under "what masking misses":**
  - SQL `INSERT … VALUES` by position;
  - a password alone on a line;
  - a `-p` flag outside a MySQL client;
  - a URL password with a raw `/`;
  - field names `SECRET_NAME` doesn't match, such as `key`.

**Mutation:** 35 hand mutants of this round's code. 26 were killed at first. The 8 survivors that weren't equivalent got the tests above and are killed now. The last was a percent-escape lookbehind in the key pattern, which turned out redundant (the key after `%22` is found anyway), so I removed it.

**Tests:** 831 passed and 0 failed on Node 24 and on Node 22 (`node --test --test-force-exit`). CI is green on `4a284f9`.
