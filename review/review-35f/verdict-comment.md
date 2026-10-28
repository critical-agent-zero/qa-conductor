**Independent delta review (orchestrator) of `4a284f9..4ed6449`, round 6 (W28=B bar): REQUEST_CHANGES. Round 5's regressions are fixed, but two new masking regressions are blocking. One of them came from my own round-5 nit.**

Two reviewers checked this round: one the fixes, one hunting regressions by comparing outputs against `7193877` and `4a284f9`. Two skeptics checked each serious finding. Both highs were upheld 4–0 (two reviewers found the DSN one independently, merged below). The medium went to low and nit.

**Round 5, item by item:**
- **Fixed: a secret key after `%3d` or `%3a`.** A key can now start after any `%xx`. All four shapes are masked, with 0 regressions in 150,000 fuzz cases against `7193877`, and the mutants are killed.
- **Fixed: a secret-named tag with `<` in an attribute.** Tags are now matched by name alone (`(?=[\s/>])`). It's a superset of `7193877`'s matches, with 0 fuzz regressions. Self-closing, split-line, tab, CRLF and nbsp tags all stay masked.
- **Fixed: the folded `column-dropped` flag.** With five `aa_tmp_*` padding columns, it reads `fields ['email', …], seeded 1`, trusted or not. `fieldsBefore` holds declared names only, never values.
- **Fixed: smaller masking gaps:**
  - word-only names after `%xx`, `\n` or `\t`;
  - the pair rule now tries any name-like key;
  - settings rows;
  - flags before a tab;
  - PGP keys.
- **Fixed: a left-out base-pane `unverified`** now sorts with the data-losing flags.
- **Fixed: `LOSES_ROWS` naming.**
- **Partly fixed:** DSN and attribute variants (see 1 and 2), the mutants (21 of 25 now killed), and the timing-test headroom.

**Tests and CI:** 71/71 in `data-diff`, full suite green, CI green.

**Please fix:**
1. **High (regression; my round-5 nit caused it): a DSN password containing `:` shows in clear again.**
   - I suggested keeping `:` out of the DSN password class for speed. That speed is document-only under W28=B, and it costs masking.
   - These were masked at `4a284f9` and show at `4ed6449`, whole or in part:
     - `root:Zq9SeCr3tVal:@tcp(db)/app`;
     - `root::pw@tcp(…)`;
     - `root:Zq9Se:Cr3tVal@tcp(…)`, with the first part shown;
     - the same with `@unix(` and `@udp(`, and inside log lines.
   - In 6,000 generated DSNs, 460 passwords hold `:`. `4a284f9` masked all of them; at this head 153 show whole and 307 in part.
   - Fix: restore `([^\s/]{1,256})@(…)`, which keeps "up to the last `@`". It passes all 71 tests and has 0 fuzz regressions. The 'a:' cost goes back to about 170–220 ms per 256 KB; note that in the README's Hostile PR data limit.
   - Remove "a DSN password with a `:`" from README:419, and add tests for `root:pa:ss@tcp(…)`, `root:pw:@tcp(…)` and `root::pw@tcp(…)`.
2. **High (regression): the widened DSN rule can swallow a secret element's closing `>`, so the element's value shows.**
   - `maskInText` applies the DSN rule before the element rule (`ATTR_TAG`, line 243). When the element's last attribute holds `:` and the text after its `>` reaches an `@word(`, `@(` or `@/` with no whitespace, the DSN match eats the `>`.
   - These were masked at `4a284f9` and are in clear now:
     - `<input type="password" name="pw" value="S" style="width:100%"><style>@media(…)`;
     - `<input type="hidden" name="api_token" value="S" style="display:none"><style>@supports(…)`;
     - `<x id="secret" value="S" href="mailto:a@b.c">…`.
   - That's realistic minified markup.
   - Fix: apply the element rule first in `maskInText`. It passes the full suite and hides all 9 corpus regressions, including one already in clear at `4a284f9`.

**To stop this pattern:** this is the third round in which a masking fix (twice from my own suggestions) un-masked something an earlier head masked. Please add a **masking regression corpus test**: one table of every shape any review has reported as masked, all of which must stay masked. Run the reviewers' differential fuzz (`review-35e`/`35f` `fuzz-mask` and `fuzz-dsn`) against `4a284f9` before pushing a masking change.

**Low:**
- **Seeded columns are matched by exact name.** A seeded column the PR renames *before the first snapshot* counts as the PR's own, so its drop lists `seeded: 0` behind padding. The boot span catches the rename. Say in README:440 that `seeded` matches by name against the base pane's before snapshot. Computing it as "base fields the PR's after snapshot lacks" is optional.
- **README:419's misses list** should add a `<` or `>` in any attribute of a secret-named element, and a DSN password containing `/`.
- **13 non-equivalent mutants survive.** Among them:
  - the left-out branch where the PR diff lacks the collection;
  - `value="it's…"`;
  - `fieldsBefore` taken from the after snapshot;
  - `\s{0,31}`;
  - MYSQL in upper case;
  - a namespaced element.
- **A seeded collection pushed into a count-only stub and wiped** is one red `unverified` that sorts late. Rank it with the row-losing flags, as `leftOut` is, or document it.
- **The row-level pair rule masks key fields named `value`/`val`/`v`,** so renaming a row turns an update into a delete plus an insert. Skip the collection's key fields.
- **Masking residuals in clear at every head:** `%25`-encoded tags, `&lt;`-escaped tags, KEY/VALUE in the strict branch, `setting` pairs. List them, or extend the rules.

**Nits:**
- **The tag timing test is still wall-clock,** and it no longer separates `7193877`'s pattern on an idle machine. Measure CPU time, or drop it (W28=B).
- **Stale comments:** the `flagChanges` block comment and the CHANGELOG's naming of `fieldsBefore` and `seeded`.
- **README:435's flag shape** omits `seeded`, `collections` and `names`.
