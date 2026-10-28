**Independent delta review (orchestrator) of `7193877..4a284f9`, round 5 (W28=B bar): REQUEST_CHANGES. Round 4 is fixed or documented as agreed, but two masking regressions are blocking (one comes from my own round-4 suggestion), plus one medium**

Two reviewers looked at this round: one checked the round-4 fixes, the other hunted for unmasking and hiding. Following the W28=B decision, findings about speed or memory under hostile PR data are recorded only as documentation nits. Two skeptics checked each serious finding: both highs were upheld 2–0, and the medium 1–1, at medium and low.

**Round 4, item by item:**
- **Fixed: the tag pattern's slowdown.** A 256 KB `<a ` cell takes 7.8 ms, down from 87 ms, and the timing test kills the old pattern. But see 2.
- **Fixed: `column-dropped` folded per collection.**
  - 1,598 padding columns on `accounts` now give 3 flags, with `users:delete` at index 0.
  - A real drop of `users.email` is still flagged and named.
  - Shared vs red is decided correctly.
  - But see 3.
- **Fixed: the pair rule.** HAR cookies, SSM Parameters, `{name:'password', value, +5}` and a second value key are masked again, and the loose spellings stay bounded as documented.
- **Fixed: over-long names.** They no longer count as left out: a drop beside a 201-character collection reads `dropped`.
- **Fixed: the round-4 mutants.** All 16 surviving ones are now killed.
- **Fixed: the value-masking residuals:**
  - token-as-user URLs;
  - a short base64 `Basic` value;
  - entities in any case.

  Prose like "Basic introduction" is still kept in clear.
- **Fixed: many of the cheap secret shapes:**
  - backtick keys;
  - wide spacing;
  - percent-encoded keys;
  - `--password` and `mysql -p`;
  - Go DSNs, JWTs and PEM keys;
  - `<add key value>`, `<input type=password>` and Spring `<property>`.

  The rest are listed as known gaps.
- **Documented (W28=B):**
  - masking work scales with raw bytes;
  - heap per row;
  - the name→count stubs.

  The README limit is accurate: it says about 4 minutes for 32 MB of JSON-looking lines (measured at 245 s), and about 600 MB of heap for 29 MB of empty rows.

**Tests and CI:** 65/65 in `data-diff`, full suite green, CI green.

**Please fix:**
1. **High (regression): a secret key right after a percent-encoded `=` or `:` is no longer masked.**
   - `KEY_IN_TEXT` now ends a match at `%3d` or `%3a`, whose last character is a word character. The next key then fails the `(?<![\w.-])` lookbehind.
   - These were masked at `2ec0bba` and `7193877`, and are in clear now:
     - `x%3dpassword=…`;
     - `x%3Apassword: …`;
     - `value%3a<secret>--db-token=`.
   - A percent-heavy fuzz gives 56 regressions in 40,000 cases.
   - The shape is narrow (mixed or partial encoding), but it is a secret that two earlier heads masked.
   - Fix: let a key also start right after a percent-encoded quote or separator: `(?:(?<![\w.-])|(?<=%(?:2[27]|3[ad])))…`. The reviewer's patched copy passes all 65 tests, with 0 regressions in 150,000 fuzz cases. Add tests for these shapes.
2. **High (regression), caused by my round-4 suggestion `[^<>]`: a secret-named tag with `<` in an attribute value is no longer masked.**
   - The attribute run can't pass the `<`, so the tag never reaches its `>`.
   - `<password hint="a<b">…</password>`, `<wsse:Password Type="a<b">`, `<secret-note title="x < y">` and `<Password placeholder="<enter>" />` were masked whole at `7193877` and are in clear now.
   - HTML5 allows `<` in attribute values. A mixed fuzz gives 1,300 regressions in 30,000 cases.
   - Fix: don't scan attributes at all. Match the tag name followed by whitespace, `/` or `>`: `/<(?:[\w.-]{1,64}:)?([\w.-]{1,128})(?=[\s/>])/g`.
     - It's a superset of `7193877`'s matches, and linear.
     - All four shapes are masked, with 0 fuzz regressions, and all 65 tests pass.
     - A 256 KB `<a ` cell takes 33 ms (fine under W28=B).
   - Give the tag timing test more headroom, or measure CPU time, since it flaked under heavy load.
3. **Medium: the folded `column-dropped` flag names the first five dropped fields in sorted order,** so a PR can hide which seeded column it dropped.
   - The PR's migration adds `aa_tmp_0000`–`aa_tmp_0004` to the seeded `users`, then the click drops them and `email`.
   - The one flag reads "users: 6 columns dropped: aa_tmp_0000…", which looks like a cleanup of the PR's own columns, and `email` appears nowhere in the flag list. At `7193877`, `email` had its own red flag.
   - The diff and divergence still name `email`, and the flag stays red and counted.
   - Fix: list first the dropped fields the base pane's snapshot also declares (carry the before snapshot's declared fields through, which `diffSnapshots` already reads), with their own count. Or keep one flag per seeded field, bounded by `main`'s schema, and fold only the PR's own. Add a test with five padding columns that sort before `email`.

**Low:**
- **Word-only secret names** (`pw`, `pin`, `psk`, `auth`) are missed right after a percent-escape or a `\n`/`\t` escape.
- **The pair rule takes only the first name-like key,** so `{key:'mail.smtp', name:'Password', value}` shows its value. Test every name-like key.
- **The new DSN and attribute rules miss common variants:** unquoted attribute values, `@/` DSNs, and others. Widen them or list them.
- **An `unverified` hidden by 11,000 empty tables sorts after every other base-pane flag,** so padding on other seeded collections can bury it. The reply's "at the top of the base pane's flags" is wrong. Put a base-pane `unverified` whose collection may have been left out among the data-losing kinds.
- **25 non-equivalent mutants of this round's code survive (109 run).** The worst is `column-dropped` shared by count only, which shows a PR's drop of `users.email` as amber when the base dropped a different column. The review's findings list the tests to add.
- **Other masking residuals** were in clear at `7193877` too, so they're not regressions:
  - rows shaped as name/value pairs;
  - a flag before a tab;
  - PGP keys.

**Nits:**
- **The DSN pattern** backtracks at every `word:` (142 ms per 256 KB). Keep `:` out of the password class, or drop "each linear" from the comment (W28=B: document).
- **The new order's naming:** it counts `key-lost` as losing data but not `column-dropped`. Rename the group or add `column-dropped` to it.
