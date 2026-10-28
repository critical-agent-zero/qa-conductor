SRC = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/regress/corpus-cases.mjs'
OUT = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/test/data-masking-corpus.test.mjs'
src = open(SRC).read()
body = src[src.index("export const S = 'Zq9SeCr3tVal'"):]
body = body.replace('export const S =', 'const S =').replace('export const cells =', 'const cells =').replace('export const rows =', 'const rows =')
# extra cases from round 6's verdict (the DSN-swallowing shapes)
extra = r"""
// Round 6's highs, and its own corpus of them.
Object.assign(cells, {
  r6_dsn_pa_ss: [`root:pa:ss${S}@tcp(127.0.0.1:3306)/app`, S],
  r6_dsn_pw_colon: [`root:${S}:@tcp(db)/app`, S],
  r6_dsn_colon_pw: [`root::${S}@tcp(db)/app`, S],
  r6_dsn_colon_mid: [`root:Zq9Se:Cr3tVal@tcp(db)/app`, 'Zq9Se', 'Cr3tVal'],
  r6_elem_style_media: [`<input type="password" name="pw" value="${S}" style="width:100%"><style>@media(max-width:1px){}</style>`, S],
  r6_elem_hidden_supports: [`<input type="hidden" name="api_token" value="${S}" style="display:none"><style>@supports(x:y){}</style>`, S],
  r6_elem_mailto: [`<x id="secret" value="${S}" href="mailto:a@b.c">x</x>`, S],
  r6_elem_slash: [`<input type="password" value="${S}" style="a:b">x@/y`, S],
})
"""
known = [
    'scheme_short_alpha', 'attr_tag_lt', 'np_input_gt_in_value', 't_open_eol', 't_close_only', 't_close_ns_only', 't_dbl_ns',
    't_html_escaped', 't_pct_escaped', 't_json_escaped', 't_bang', 't_question', 'p_5b', 'p_dbl_pct', 'p_dbl_pct_amp',
    'p_smart_quote', 'p_pin_hexlike', 'p_bs_u', 'p_bs_x', 'p_unicode_esc', 'd_slash_pw', 'a_value_empty_then',
    'r_settings_KEY_VALUE7', 'r_settings_loose_wide', 'r_option_name', 'r_setting_value',
]
head = """// The masking regression corpus (#35, from round 6 of its review): every
// shape a review round has reported, as one table. Each case is a value
// (in a neutral field, `note`) or a whole row, with the secrets that must
// never show. A masking change must keep every one of them hidden: three
// rounds in a row, a fix for one shape unmasked another an earlier head had
// masked. KNOWN_MISSES are shapes no head has masked yet; the README lists
// them under "what masking misses", and a change that masks one should move
// it out of the list.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createMasker, sanitizeSnapshot, validateRules } from '../lib/data-diff.mjs'

const KEY = Buffer.alloc(32, 7)
const rules = validateRules({})
const masker = createMasker({ key: KEY, rules })
const snap = collections => sanitizeSnapshot({ collections }, { masker, rules })
const cell = v => JSON.stringify(snap({ c: { key: ['id'], rows: [{ id: 1, note: v }] } }).collections.c.rows[0].note)
const row = r => JSON.stringify(snap({ c: { key: null, rows: [r] } }).collections.c.rows[0])

"""
tail = """
const KNOWN_MISSES = new Set(%s)

test('the masking corpus: every shape a review reported as masked stays masked', () => {
  const shown = []
  for (const [kind, table, read] of [['cell', cells, cell], ['row', rows, row]]) {
    for (const [name, [value, ...secrets]] of Object.entries(table)) {
      if (KNOWN_MISSES.has(name)) continue
      const out = read(value)
      const leaked = secrets.filter(secret => out.includes(secret))
      if (leaked.length) shown.push(`${kind} ${name}: ${out}`)
    }
  }
  assert.deepEqual(shown, [])
  assert.ok(Object.keys(cells).length + Object.keys(rows).length > 250)
})

test('the masking corpus\\'s known misses are still the corpus\\'s, so the list stays honest', () => {
  for (const name of KNOWN_MISSES) assert.ok(Object.hasOwn(cells, name) || Object.hasOwn(rows, name), name)
})
""" % ('[' + ', '.join(f"'{k}'" for k in known) + ']')
open(OUT, 'w').write(head + body + extra + tail)
print('ok')
