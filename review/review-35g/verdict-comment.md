**Independent delta review (orchestrator) of `4ed6449..4033285`, round 7: REQUEST_CHANGES. Masking regressions: secrets that `4ed6449` masked are in clear again. Three are confirmed by independent checks.**

A usage limit cut this round short on 2026-10-22. Both review lenses finished: one on round 6's items, one hunting regressions against every earlier head. Only 5 of the 16 skeptic checks ran. All 5 upheld their finding. Below, each finding says whether it was independently confirmed.

**What holds:**
- The ':' DSN password is fixed. The corpus holds it, and fuzzing finds no DSN class in clear.
- The corpus test is real: 257 shapes, and it kills every round-6 regression mutant.
- The reported differential fuzz reproduces. Against 2ec0bba, 7193877, 4a284f9 and 4ed6449, the fuzz, fuzz-keys, fuzz-mask and fuzz-dsn modes find 0 regressions.
- The scheme-word fix is in, the seeded-name docs are updated, and the left-out ordering is fixed.

But regressions remain outside what that fuzz generates.

**One of these is mine.** Finding 1 comes from the change I asked for in round 6 ("skip the collection's key fields"). That is the third round in which a masking change a reviewer asked for un-masked something. I withdraw that request: restore `4ed6449`'s behaviour.

### Blocking

**1. High, confirmed by two skeptics: a row-pair secret in a declared key field is shown in clear.** It was masked at `4ed6449`. Cause, L586: `paired = pair !== null && pair.values.includes(field) && !named.includes(field)`.

Shapes, shown as 4a284f9 / 4ed6449 / 4033285:
- `tokens {key:['value'], rows:[{name:'deploy_token', value:S}]}`: clear / masked / **clear**;
- `settings {key:['key','value'], rows:[{key:'smtp_password', value:S}]}`: clear / masked / **clear**;
- `kv {key:['k','v'], rows:[{k:'api_token', v:S}]}`, `{key:['id','name','value']}` with `name:'STRIPE_SECRET_KEY'`, and `{key:['Name','Value']}`: the same.

It's worse in a diff. A rotated secret in a key field shows both the old and the new value, in the row and in the `key` string: `inserted key:"[\"Xy7NewSecretV\"]"`, `deleted key:"[\"Zq9SeCr3tVal\"]"`.

Two more points:
- The exclusion tests the *declared* key. A collection whose key was dropped for duplicates still shows the value.
- The corpus can't see any of this, because its `row()` helper uses `key: null`. test/data-diff.test.mjs:1574 pins the value as unmasked.

**Fix:** mask a pair's value fields even when they are key fields, as 4ed6449 did.
- What it costs: renaming a row so that its name stops or starts looking secret reads as a delete plus an insert. That over-flags and hides nothing. The digest covers collection, field and value, so an ordinary rename is still one update.
- Update README:412 and the test at L1574.
- Add corpus rows with a declared key: `key: ['value']`, `['key','value']`, `['k','v']`, an all-columns key, and a duplicate-dropped key.

**2. High, confirmed by one skeptic: moving the element rule ahead of the DSN and JWT rules un-masks three element shapes.** 4ed6449 masked them, and so did 4a284f9 mostly. ATTR_TAG (L393) now reads the raw text, before DSN and JWT shorten it or take out a `<` or `>`.

Shapes, shown as 2ec0bba / 7193877 / 4a284f9 / 4ed6449 / 4033285:
- **E1, the 1,024-character tag bound now counts raw JWT and DSN text.**
  - `<input type="password" value="S" data-x="<JWT of ~1,000 chars>">`: clear / clear / masked / masked / **clear**.
  - The same for `<add key="ClientSecret" value="S" note="<JWT>"/>`, for four 256-character DSN passwords in sibling attributes, and for the unquoted `<i type=password value=S a=<JWT>>` (masked only at 4ed6449).
  - The threshold is the raw tag length: a ~600-character JWT still masks, ~900 or more shows.
- **E2, a DSN password holding `<` in a sibling attribute.** `<add key="DbPassword" value="S" note="u:a<b@tcp(h)/d"/>`: clear / clear / masked / masked / **clear**.
- **E3, a DSN that starts inside a secret element's value, with its password across the `>`.**
  - `<input type=password value=root:ab>S@tcp(db)/app`: clear / clear / masked / masked / **clear**.
  - `<x name=secret value=u:p>S@/db`: masked at 4ed6449, clear at head.
  - A quoted variant regresses too.

Fuzz: two independent generators found thousands of E1 cases, mostly from long-attribute modes, and about 100 to 2,000 E2 and E3 cases, so the reply's "0 regressions against 4a284f9 and 4ed6449" doesn't cover these shapes. The README names neither E1 nor E3. E2 is covered only loosely, by "any of its attributes holds a `<` or `>`".

### Found by a reviewer, not yet independently confirmed

The skeptics for these were cut off. Each finding has a probe with outputs for all five heads. Fix them, or show they're wrong, in the reply.

**3. High: the scheme rescan swallows a trailing scheme word, so the token after it shows** (L410-411). After a token value, authValues consumes the whole match; after a non-token value, only the scheme's name. Shapes, shown as 2ec0bba / 7193877 / 4a284f9 / 4ed6449 / 4033285:
- `Bearer ab/token x1/token S`: clear / clear / masked / masked / **clear**. The same holds behind `Authorization header: `.
- `x/token //bearer HX4coiQx:S:t9Gk@tcp(h)/d`: masked only at 4a284f9.
- Present since 4a284f9: `Basic //bearer S`.

These shapes are contrived: 2 in 1.53M fuzz cases.

**4. High: an empty unquoted name-like attribute takes the next attribute's name as its value** (L394). Since 4ed6449, ATTR_NAME's bare alternative consumes the following attribute's name, so that attribute's `name="password"` is never read.
- `<input type= name="password" value="S">` and `<add key=key="ApiToken" value="S" />`: masked at 4a284f9, clear since 4ed6449.
- The markup is malformed.

**5. Medium, upheld by one skeptic, not a regression: the URL rule still runs first and swallows a secret element's `>`.** URL_USERINFO's password class `[^\s/]{0,256}` (L389) runs past quotes and `>` to the next `@`. These are in clear at every head:
- `<input type="password" name="pw" value="S" data-api="http://api:8080"><small>help@corp.com</small>`;
- `<input name="api_key" value="S" placeholder="https://host:443"><p>Contact:support@example.com</p>`;
- `<add key="DbPassword" value="S" uri="redis://cache:6379"><x>ops@corp</x>`.

This shape was already in round 6's probes. The reply and the L230-232 comment say the URL rule "can't run past a `>`". That is wrong: it is true for the scheme rule only.

**Don't just reorder.** A skeptic showed that scheme → element → URL masks these, but un-masks a URL whose scheme word follows "token" or "Bearer". These are masked at every head and in clear under that reorder:
- `token s3+https://key:S@bucket`
- `Bearer neo4j+ssc://neo4j:S@db:7687`
- `use token mongodb+srv1://u:S@cluster0`
- `token rediss-cluster2://u:S@cache`

**6. Medium, not a regression: a secret element's value shows in two cases.**
- **Its other attributes run past 1,024 characters**, with the value first: `<add key="DbPassword" value="S" description="<1,100 chars>"/>`, `<input type="password" value="S" class="<260 × 'btn '>">`.
- **A later attribute's URL swallows the `>`.**

corpus `np_add_long_attr` passes only because its value lies past the 200-character cell cut. Put the value first.

### Lower

- **Low (upheld by a skeptic, rated low): the corpus misses shapes earlier rounds' probes held.**
  - `mongodb+srv://admin:S@cluster0.x.net/db` is missing, and so is any scheme with `+` or a digit. A mutant narrowing the scheme to `[a-z]{1,30}` passes every test, and shows `mongodb+srv`, `postgresql+psycopg2://` and `s3://` passwords.
  - The URL-eats-`>` shapes are missing.
  - So README:428's "every shape a review has reported" is too strong. Add the shapes, or soften the sentence.
- **Low: 16 of 108 masking mutants survive the corpus and data-diff tests, and 7 un-mask realistic shapes.** Add one corpus cell per survivor:
  - a DSN password holding `>` and `<` (fuzz-dsn: the `[^\s/>]` mutant shows 589 of 6,000);
  - `app-user:` and `app.user:` DSN users;
  - a DSN password over 64 characters;
  - a JWT whose signature holds `-` and `_`;
  - an upper-case URL scheme;
  - `--PASSWORD`;
  - a pair nested three JSON strings deep.
- **Low: fuzz-values residuals.** Over seeds 1 to 9 there are 3 against 4a284f9 and 16 against 4ed6449. The reply's 0 holds for seeds 1 and 2 only. These are the contrived "DSN starts inside an element's value" class that round 6 accepted. List them in the README misses and name the seeds in the reply.
- **Low: the known-miss list.**
  - KNOWN_MISSES says "no head has masked yet", but `scheme_short_alpha` was masked at 2ec0bba. That was a deliberate trade, made in round 3.
  - The honesty test only checks that names exist. Make it assert that each known miss still shows its secret.
- **Low: round 6's flag-code mutants partly survive.** None hides a flag today. Add tests for:
  - the PR's entry omitted while the base pane's is cut short;
  - PR-own dropped columns declared out of order;
  - cleared on rows 1 to 3 with the base clearing row 3;
  - a softDelete field named `value` in a pair row;
  - the null fold sorting after a base collection's column-dropped.
- **Low, residuals at every head that aren't listed:** a whole URL percent-encoded in a parameter, `password%20%3D%20S`, Oracle EZConnect `scott/S@//db:1521/ORCL`, and `<meta name="csrf-token" content="…">`. List them, or extend the rules.
- **Nits:**
  - README:419 omits `<a:b:password>` and `user%5Bpassword%5D=S`, both in KNOWN_MISSES.
  - The ':' DSN class over-masks colon ids and CSS, for readability only; keyed diffs still match.
  - At README:426, say "Bearer, Basic or Token".

### A reviewer's prototype (a starting point, not a prescription)

The regression reviewer prototyped a different structure for maskInText:
- every text rule reads the original text, and the union of their spans is replaced;
- the element rule reads both the text as is and a copy with the other rules' spans blanked;
- ATTR_TAG is unbounded (`[^<>]*` stays linear: each attempt stops at the next `<`);
- ATTR_NAME's bare alternative becomes a lookahead.

Its reported results:
- it masks findings 2 to 6's shapes;
- it passes the data-diff and corpus tests (75/75);
- a 774,872-case differential fuzz found 0 regressions against 4033285 and 4ed6449, and a skeptic's separate 20,000-case fuzz found 0 against 4a284f9 and 4ed6449;
- CPU is about the same as head.

It has **not** been checked against finding 1, round 7's other shapes, or the scheme-after-"token" URLs above.

<details><summary>Prototype diff against 4033285's lib/data-diff.mjs</summary>

```diff
@@ -227,29 +227,55 @@ export function createMasker({ key, rules }) {
   const maskInText = (s, where) => {
     const head = s.length > HELD_JSON_MAX ? s.slice(0, HELD_JSON_MAX) : s
     const hidden = (tag, value) => `[secret ${mac(`${tag}:${where}\u0000${value}`, 8)}]`
-    // In this order: a URL's credentials and a scheme's value first (as
-    // before round 6), then an element's value, before a DSN's rule, whose
-    // password may hold '>' and so could otherwise run past the element's
-    const withUrls = head.replace(URL_USERINFO, (_, scheme, user, pw, token) => {
-      if (token !== undefined) return `${scheme}${hidden('u', token)}@`
-      // a user that is a token: one that looks like it, or one with no
-      // password or GitHub's x-oauth-basic beside it
+    // PROTOTYPE (review): every rule reads the text as it is, and the union
+    // of what they hide is replaced, so no rule's replacement can hide
+    // another's match
+    const spans = []
+    const add = (tag, [a, b], empty = false) => { if (b > a || empty) spans.push([a, b, tag]) }
+    for (const m of head.matchAll(URL_USERINFO_D)) {
+      const [, , user, pw, token] = m
+      if (token !== undefined) { add('u', m.indices[4]); continue }
       const oauth = /^x-oauth-basic$/i.test(pw)
-      const userShown = user !== '' && (tokenLike(user) || pw === '' || oauth) ? hidden('u', user) : user
-      return `${scheme}${userShown}:${pw === '' || oauth ? pw : hidden('u', pw)}@`
-    })
-    const masked = authValues(withUrls, value => hidden('a', value))
-      // an element whose key, name, id or type looks secret: its value
-      .replace(ATTR_TAG, tag => ([...tag.matchAll(ATTR_NAME)].some(m => SECRET_NAME.test(m[2] ?? m[3] ?? m[4]))
-        ? tag.replace(ATTR_VALUE, (_, name, eq, dq, sq, bare) => {
-          const value = dq ?? sq ?? bare
-          const q = dq !== undefined ? '"' : sq !== undefined ? "'" : ''
-          return `${name}${eq}${q}${hidden('x', value)}${q}`
-        })
-        : tag))
-      .replace(DSN_USERINFO, (_, user, pw, rest) => `${user}:${hidden('d', pw)}@${rest}`)
-      .replace(JWT, value => hidden('j', value))
-    return head === s ? masked : masked + s.slice(HELD_JSON_MAX)
+      if (user !== '' && (tokenLike(user) || pw === '' || oauth)) add('u', m.indices[2])
+      if (!(pw === '' || oauth)) add('u', m.indices[3])
+    }
+    const re = new RegExp(AUTH_VALUE.source, 'gid')
+    for (let m = re.exec(head); m !== null; m = re.exec(head)) {
+      if (authToken(m[1], m[2])) add('a', m.indices[2])
+      re.lastIndex = m.index + m[1].length
+    }
+    for (const m of head.matchAll(DSN_USERINFO_D)) add('d', m.indices[2])
+    for (const m of head.matchAll(JWT)) add('j', [m.index, m.index + m[0].length])
+    // an element whose key, name, id or type looks secret: its value, read
+    // in the text as is and with what the rules above hide blanked out
+    let blanked = head
+    if (spans.length) {
+      const chars = head.split('')
+      for (const [a, b] of spans) for (let i = a; i < b; i++) chars[i] = 'x'
+      blanked = chars.join('')
+    }
+    for (const t of blanked === head ? [head] : [head, blanked]) {
+      for (const m of t.matchAll(ATTR_TAG)) {
+        const tag = m[0]
+        if (![...tag.matchAll(ATTR_NAME)].some(n => SECRET_NAME.test(n[2] ?? n[3] ?? n[4]))) continue
+        for (const v of tag.matchAll(ATTR_VALUE_D)) {
+          const k = v[3] !== undefined ? 3 : v[4] !== undefined ? 4 : 5
+          add('x', [m.index + v.indices[k][0], m.index + v.indices[k][1]], true)
+        }
+      }
+    }
+    if (!spans.length) return s
+    spans.sort((x, y) => x[0] - y[0] || y[1] - x[1])
+    const merged = []
+    for (const sp of spans) {
+      const last = merged[merged.length - 1]
+      if (last && sp[0] < last[1]) { if (sp[1] > last[1]) last[1] = sp[1]; if (sp[2] !== last[2]) last[2] = 'm' } else if (last && sp[0] === last[0] && sp[1] === last[1]) { /* same */ } else merged.push([...sp])
+    }
+    let out = ''
+    let at = 0
+    for (const [a, b, tag] of merged) { out += head.slice(at, a) + hidden(tag, head.slice(a, b)); at = b }
+    out += head.slice(at)
+    return head === s ? out : out + s.slice(HELD_JSON_MAX)
   }
@@ -389,10 +415,13 @@ const PEM_KEY = /-----BEGIN [A-Z ]{0,64}PRIVATE KEY(?: BLOCK)?-----/
 const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\/\/)(?:([^\s/:@]{0,256}):([^\s/]{0,256})|([^\s/:@]{16,256}))@/gi
 const AUTH_VALUE = /\b(bearer|basic|token)\s{1,4}([A-Za-z0-9._~+/=-]{8,})/gi
 const DSN_USERINFO = /(?<![\w.-])([\w.-]{1,64}):([^\s/]{1,256})@((?:[a-z][\w-]{0,31})?\(|\/)/gi
+const URL_USERINFO_D = new RegExp(URL_USERINFO.source, 'gid')
+const DSN_USERINFO_D = new RegExp(DSN_USERINFO.source, 'gid')
 const JWT = /(?<![\w-])eyJ[\w-]{4,}\.eyJ[\w-]{4,}\.[\w-]{4,}/g
-const ATTR_TAG = /<[\w:.-]{1,64}\s[^<>]{0,1024}>/g
-const ATTR_NAME = /\b(key|name|id|type)\s*=\s*(?:"([^"<>]{1,128})"|'([^'<>]{1,128})'|([^\s"'<>=\x60]{1,128}))/gi
+const ATTR_TAG = /<[\w:.-]{1,64}\s[^<>]*>/g
+const ATTR_NAME = /\b(key|name|id|type)\s*=\s*(?:"([^"<>]{1,128})"|'([^'<>]{1,128})'|(?=([^\s"'<>=\x60]{1,128})))/gi
 const ATTR_VALUE = /\b(value)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'<>=\x60]+))/gi
+const ATTR_VALUE_D = new RegExp(ATTR_VALUE.source, 'gid')
```
</details>

### Before the next push

1. **Fix findings 1 and 2.** Fix findings 3 to 6 too, or answer each with evidence.
2. **Add every shape in this comment to the corpus,** as cases or as known misses with a README entry. That includes the declared-key rows, E1 to E3, the URL-in-element shapes and the scheme-after-"token" URLs.
3. **Run a differential check against every earlier head:** 2ec0bba, 7193877, 4a284f9, 4ed6449 and 4033285.
   - Use more than two seeds.
   - Include generators for long attributes, keyed pair rows, and markup with DSNs and URLs inside elements.
   - Report what each generator produces.
4. **Reply item by item.**

#36 will need this round merged in afterwards.
