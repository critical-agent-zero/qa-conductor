// The author's round-7 claims: (1) pure element-first regressed vs 4a284f9
// on an unquoted value=Bearer; (2) a scheme word that isn't a token no
// longer hides the next one (and 7193877 masked it, 4a284f9 didn't).
import { M, mk } from './h.mjs'
const VFIX = mk(await import('../../review-35f/regress/vfix/data-diff.mjs'))
const EF = mk(await import('./mut/order_element-first/lib/data-diff.mjs'))
const CONSUME = mk(await import('./mut/auth_consume-non-token/lib/data-diff.mjs'))
const S = 'Zq9SeCr3tVal'
const T = 'abcdefghij123456'
const heads = { '2ec0bba': M['2ec0bba'], '7193877': M['7193877'], '4a284f9': M['4a284f9'], '4ed6449': M['4ed6449'], '4033285': M['4033285'], 'vfix35f(elem-first+dsn)': VFIX, 'mut:element-first': EF, 'mut:auth-consume': CONSUME }
const cases = {
  elem_unquoted_bearer: [`<input type=password value=Bearer ${S}:"/>`, S],
  elem_unquoted_basic: [`;<input type=password value=Basic ${S},x"/>`, S],
  elem_unquoted_bearer_plain: [`<input type=password value=Bearer ${S}>`, S],
  elem_quoted_bearer: [`<input type="password" value="Bearer ${S}">`, S],
  elem_name_auth_unquoted: [`<input name=authorization value=Bearer ${T}>`, T],
  auth_after_word: [`x Bearer //bearer  ${S}mysql://u:%26value\t=`, S],
  auth_after_word_plain: [`x Bearer //bearer  ${T} y`, T],
  auth_prose_then_token: [`Token expired; got Bearer ${T}`, T],
  auth_prose_word_token: [`Basic introduction Bearer ${T}`, T],
  auth_nontoken_then_basic: [`Basic abcdefgh.basic ${T}`, T],
  auth_value_holds_scheme: [`Bearer a.b.c.d.e.token ${T}`, T],
  auth_two_spaces_nontoken: [`token  ..........bearer ${T}`, T],
  auth_8char_nontoken_then: [`Bearer abcdefgh Bearer ${T}`, T],
  prose_kept_1: ['Token expired again', 'expired'],
  prose_kept_2: ['Basic introduction to the topic', 'introduction'],
}
const names = Object.keys(heads)
console.log('case'.padEnd(28), names.map(n => n.slice(0, 12).padEnd(12)).join(' '))
for (const [label, [v, ...secrets]] of Object.entries(cases)) {
  const outs = names.map(n => heads[n].cell(v))
  const st = outs.map(o => (secrets.some(x => o.includes(x)) ? 'CLEAR' : 'ok'))
  console.log(label.padEnd(28), st.map(s => s.padEnd(12)).join(' '))
  console.log('   4033285:', outs[names.indexOf('4033285')].slice(0, 160))
  if (label.startsWith('elem_unquoted_b')) console.log('   elem-first:', outs[6].slice(0, 160), '\n   vfix:', outs[5].slice(0, 160))
}
