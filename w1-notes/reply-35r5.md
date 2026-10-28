**Round 5, item by item: in `4ed6449`,** one commit on `4a284f9`. `main` is still `561bd84`, and `git diff --name-status 561bd84..4ed6449` lists only this PR's own files.

**1. High (regression): a key right after `%3d` or `%3a` wasn't read.** Fixed.
- **A key may start right after any percent-escape:** `(?:(?<![\w.-])|(?<=%[0-9a-f]{2}))`. That covers the separators, and the escapes of quotes and `&` too.
- **Names that are words, from the low:** when a match starts inside an escape (`%26pin%3D` reads the key `26pin`, and `\npw=` reads `npw`), the name past the escape's two hex digits, or its letter, is tested too.
- **I dropped the backslash alternative you suggested,** since it was redundant. A backslash is no word character, so a match may already start at an escape's letter, and the strip handles it. Its mutant survived for that reason.
- **Tests:**
  - these are masked whole: `x%3dpassword=…`, `x%3Apassword: …`, `value%3a<secret>--db-token=`, `state%3A…%22token%22%3dtoken:`, `%7B%22pw%22%3A…`, `%26pin%3D…`, `%26pw%3D…`, `%0A_auth%3D…`, `\n_auth=…`, `\npw=…` and `\tpsk=…`;
  - `x%3dadpw=1` and `unpw=1` are kept, since a word that only ends so is no escape;
  - runs of `\n` are still read in well under a second.
- **Mutants:** without the percent alternative, without the strip, and without the hex or the letter strip: all killed.

**2. High (regression): a `<` in an attribute hid a secret-named tag.** Fixed as you proposed: `/<(?:[\w.-]{1,64}:)?([\w.-]{1,128})(?=[\s/>])/g`. Attributes aren't scanned at all.
- **Tests:**
  - `<password hint="a<b">`, `<wsse:Password Type="a<b">`, `<secret-note title="x < y">`, `<Password placeholder="<enter>" />`, `<token>` and `<apiKey/>` are masked;
  - `<b>bold</b> and <i>it</i>` is kept.
- **The timing test's bound is 3 s now,** with 24 cells of 256 KB. They take well under a second alone.
- **Mutants:** `[^<>]` put back, and `/` dropped from the lookahead: both killed.

**3. Medium: the fold's first five names hid a seeded column.** Fixed with your first suggestion.
- **Diff entries carry `fieldsBefore`:** the before snapshot's declared fields, already read by `diffSnapshots`, and shared, not copied.
- **The flag lists seeded fields first:** in `column-dropped`, `fields` starts with the dropped fields the base pane's before snapshot declares too, then the PR's own, each group by name. `seeded` counts the first group.
- **Test, your shape:**
  - The PR adds `aa_tmp_0000`–`aa_tmp_0004` to the seeded `users`, then drops them and `email`.
  - The one flag is red, with `count: 6`, `seeded: 1` and `fields: ['email', 'aa_tmp_0000', …]`.
  - With only its own columns dropped, `seeded` is 0.
- **Mutants:** sorted names back, and `fieldsBefore` null: both killed.

**Low, word-only names after an escape.** Fixed with 1.

**Low, the pair rule took only the first name-like key.** Fixed. Any string-valued name-like key that looks secret names the pair.
- **Tests:** `{key: 'mail.smtp', name: 'Password', value}`, `{k: 'row-17', name: 'password', value}` and `{key: 'setting_42', name: 'SMTP password', value, updated}` are masked. So are the 8-key `{key: 'password', value, …}` and `{Key: 'api_token', Value, …}` (the strict branches).
- **Rows, from the residuals:** a row shaped as a pair has its value fields masked: a settings table's `{id, key: 'smtp_password', value}` and `{id, name: 'STRIPE_SECRET_KEY', value}`. A neutral row (`site_title`) keeps its value, and a cleared value still shows.

**Low, DSN and attribute variants.** Widened, with a test each:
- **DSNs:**
  - the password runs up to the last `@` (`root:p@ss…@tcp(…)`);
  - any network: `tcp6`, `unix`, `cloudsql` and the like;
  - and `@/`.
- **The DSN nit:** the password class leaves out `:`, so a run stops at the next `:`. 256 KB of `a:` take well under a second, and the code comment no longer says "each linear".
- **Attributes:**
  - `key`, `name`, `id`, `type` and `value` are matched in any case, with values quoted either way or not;
  - so `<input type=password value=…>`, `<add KEY='DbPassword' VALUE='…'/>`, a single-quoted value holding `"`, and `<x id="password" value="…">` are masked.
- **Listed in the README** under "what masking misses": a DSN password with a `:` in it, and an element value holding `>`.

**Low, a left-out `unverified` sorted after every other base-pane flag.** Fixed. A base-pane collection's `unverified` flag now stands with what loses rows when the PR's snapshots may have left it out, which can hide a drop or a wipe. That covers a PR diff entry with `omitted` set, and a collection the PR diff lacks.
- **Test:** a wipe hidden by padding is flagged before another seeded collection's `column-dropped`. A cut-short collection's `unverified` still comes after a `mass-change`.
- **The reply's claim was wrong,** as you said: at `4a284f9` it sorted after the column and mass-change flags. It doesn't now.

**Low, the 25 mutants.** Tests added for those named:
- **`column-dropped` shared by count:** the base drops `legacy` and the PR drops `email`, trusted. The flag is red, not shared.
- **The 8-key strict pairs** (above).
- **`cleared` on 3 rows where the base cleared 1:** `shared: false`, `pr 3`, `base 1`.
- **`key-lost` before `column-dropped`,** and `delete` before `mass-change`.
- **Attribute and PEM forms:** `<add KEY='…' VALUE='…'>`, `<x id="password" …>`, PKCS#8 `BEGIN PRIVATE KEY`, EC and OPENSSH keys.
- **Other shapes:**
  - `mysqldump -p…`, `basic dXNlcjpwYXNz` (lower case), and `-password x`;
  - `%27password%27%3A…`, `root:pw@unix(…)`, and 31 spaces before `=`;
  - `X-OAUTH-BASIC`, and the `gho_`, `github_pat_`, `xoxb-` and `sk-` prefixes.

**Low, other residuals.**
- **Fixed:**
  - rows shaped as pairs (above);
  - the first-name pick (above);
  - a flag before a tab: `FLAG_IN_TEXT` takes `(?=[\s=])`;
  - PGP keys: `PRIVATE KEY(?: BLOCK)?-----`;
  - single-quoted and unquoted values.
- **Listed in the README:**
  - `{option_name, option_value}`, a pair under other names;
  - an element value holding `>`.

**Nit, the naming.** The group is `LOSES_ROWS` now: what loses rows, a collection or its key. The comment, the README and the CHANGELOG say `column-dropped` loses data too, but comes next because it is one flag a collection whatever the PR's padding.

**Mutation:** 22 hand mutants of this round's code, 19 killed.
- `VALUE` in upper case is equivalent under the `i` flag.
- The backslash lookbehind was redundant and is removed.
- Letting the DSN password cross `:` masks no less, and only costs time, which W28=B leaves to the README.

**Tests:** 837 passed and 0 failed on Node 24 and on Node 22 (`node --test --test-force-exit`); 71 are in `test/data-diff.test.mjs`. One Node 22 run had round 3's 10 MB scan test over its 5 s bound under a load average near 50 (0.7 s alone), and passed when rerun. CI is green on `4ed6449`.
