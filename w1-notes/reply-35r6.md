**Round 6, item by item: in `4033285`,** one commit on `4ed6449`. `git diff --name-status 561bd84..4033285` lists only this PR's files, plus the new `test/data-masking-corpus.test.mjs`.

**1. High (regression): a DSN password holding `:`.** Fixed as proposed. `DSN_USERINFO` is `([^\s/]{1,256})@(…)` again, up to the last `@`.
- **Tests:** `root:pa:ss…@tcp(…)`, `root:…:@tcp(…)` and `root::…@tcp(…)` are masked. So are your corpus's `d_colon_*` cases (`@unix(`, `@udp(`, in a log line, `:` and `@` together).
- **The README:** "a DSN password with a `:`" is gone from the misses. The Hostile PR data limit now names the cost: about 200 ms for 256 KB of `a:`.
- **Fuzz:** your `fuzz-dsn`, 3,000 DSNs × 2 seeds, shows none in whole or in part. 4a284f9 showed 271 and 293.

**2. High (regression): the DSN rule could swallow a secret element's `>`.** Fixed, with one difference from your fix.
- **The order is now:**
  1. a URL's credentials;
  2. a scheme's value;
  3. an element's value;
  4. a DSN's password;
  5. a JWT.

  The element rule runs before the DSN's. I didn't put it first of all: your differential fuzz, run as you asked, found that element-first was itself a regression against 4a284f9.
  - `<input type=password value=Bearer <token>:"/>`: the unquoted value `Bearer` was masked alone, and the scheme rule then never saw the token. The URL and scheme rules can't run past a `>` the way the DSN rule can, so they keep their place.
- **The fuzz found one more regression,** this one against 7193877 (4a284f9 had it too): `x Bearer //bearer  <token>…`.
  - The scheme rule consumed `Bearer //bearer` as a match, found it was no token, and skipped past it, so the `bearer <token>` inside it was never seen.
  - Now a scheme value that isn't a token is passed over by the scheme's name only.
- **Tests:** your four shapes (`style="width:100%"><style>@media(`, `@supports(`, `mailto:a@b.c`, `@/`), plus the three the fuzz found, are in the corpus and masked.

**The masking regression corpus.** `test/data-masking-corpus.test.mjs`:
- **What it holds:** one table of every shape a review round has reported, in your corpus's form, with round 6's shapes and the fuzz's three added. That is 257 values and rows, each with the secrets that must never show.
- **What it asserts:** every one stays masked.
- **Its known misses:** the 26 shapes no head has masked yet: escaped and closing-only tags, `<!`/`<?`, double-encoded keys, smart quotes, `\u`/`\x` escapes, a DSN password with `/`, an element whose other attribute holds `<` or `>`, settings rows under other names, and "Token" before a short word.
  - They are listed in `KNOWN_MISSES` and named in the README's misses. A second test keeps that list in step with the corpus.
- **The differential fuzz,** run before this push, as you asked:

| Fuzzer | Compared with | Regressions |
|---|---|---|
| `review-35e` `fuzz-mask`, 3 seeds × 20,000, and the `pct` mode | 7193877 and 4a284f9 | 0 |
| `fuzz-mask`, 3 seeds × 20,000 | 4ed6449 | 0 |
| `review-35f` `fuzz`, 3 seeds | 7193877 and 4a284f9 | 0 |
| `fuzz-keys`, 2 × 50,000 | 7193877 and 4a284f9 | 0 |
| `fuzz-values`, 2 × 20,000 | 4a284f9 | 0 |
| `fuzz-dsn` | 4a284f9 | 0 |

- **Before this push** there were 3, the ones in 2. Their fixes are in, and the cases are in the corpus.

**Low, `seeded` matched by name.** README:440 now says `seeded` matches by name against the base pane's before snapshot, so a seeded column the PR renamed before the span's first snapshot counts as its own, and the boot span shows the rename. I didn't take the optional "base fields the PR's after snapshot lacks".

**Low, the misses list.** Added: a `<` or `>` in any attribute of a secret element, and a URL or DSN password with `/`. The other residuals are added too: escaped tags, closing tags alone, `<!`/`<?`, double-encoded keys, smart quotes, `\u`/`\x` escapes, `setting` pairs, and loose or all-caps spellings in rows over six fields. The README says the corpus holds them as known misses.

**Low, the 13 mutants.** Tests added:
- the left-out branch where the PR's diff lacks the collection: its `unverified` sorts before another collection's `column-dropped`;
- `fieldsBefore` from the after snapshot: a base that dropped `legacy` while the PR dropped `email`, `legacy` and padding gives `seeded: 2`;
- `MYSQL -u root -p…` in capitals.

These are in the corpus: `value="it's…"`, 32 spaces (`sp32`), and a namespaced element (`a_ns_elem`). Of 8 hand mutants of this round's code, all are killed:
- the DSN class without `:`;
- the DSN rule removed;
- the scheme loop consuming non-tokens;
- a row pair masking a key field;
- each half of the left-out rule;
- `fieldsBefore` from after;
- `MYSQL_P` case-sensitive.

**Low, a seeded collection pushed into a count-only stub and wiped.** Ranked as you suggested. A base-pane collection the PR cut short where the base pane's wasn't now has its `unverified` with what loses rows, as `leftOut` already had for one left out. Two expectations moved to match, and the code comment and README say so.

**Low, the row pair rule masked key fields.** Fixed: a pair's value field is never one of the collection's key fields, so renaming a row stays an update. There is a test.

**Nits:**
- **The tag timing test:** dropped (W28=B). It now checks only that tag-dense text is read and that tags with a namespace or attributes are found. The DSN's `a:` timing check is gone too.
- **Stale comments:** the `flagChanges` block comment describes `seeded`, `fieldsBefore` and the new first group. The CHANGELOG names `count`, `fields`, `seeded` and `fieldsBefore`.
- **README:435's flag shape:** now `{collection, kind, severity, shared, pr, base, field?, count?, seeded?, fields?, collections?, names?}`.

**Tests:** 841 passed and 0 failed on Node 24 and on Node 22 (`node --test --test-force-exit`); 73 in `data-diff`, 2 in the corpus. CI is green on `4033285`.
