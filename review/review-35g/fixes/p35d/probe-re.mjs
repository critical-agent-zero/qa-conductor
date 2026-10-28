// (4) Each new text regex alone, and through sanitizeSnapshot, on 256 KB
// adversarial cells. Anything over ~50 ms per cell is a finding.
import { KEY_IN_TEXT, TAG_IN_TEXT, URL_USERINFO, AUTH_VALUE } from './exp/data-diff.mjs'
import { createMasker, sanitizeSnapshot, validateRules } from './repo/lib/data-diff.mjs'

const N = 256 * 1024
const fill = (unit, n = N) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n)
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const ms = fn => { const t = performance.now(); const v = fn(); return [performance.now() - t, v] }

const shapes = {
  'backslashes then =': fill('\\', N - 1) + '=',
  'word + 4096 backslashes + quote, repeated': fill('a' + '\\'.repeat(4096) + '"'),
  'word128 + backslash run + quote': fill('a'.repeat(128) + '\\'.repeat(2000) + '"'),
  '&quot; repeated': fill('&quot;'),
  '&#0000034; repeated': fill('&#00034;'),
  'a&quot; repeated': fill('a&quot;'),
  '\\" repeated': fill('\\"'),
  'a\\" repeated': fill('a\\"'),
  'word128 then spaces8 then x': fill('a'.repeat(128) + '        x'),
  'a= repeated (many matches)': fill('a='),
  'a.b-c long word = ': fill('a.'.repeat(5000) + '='),
  '<a  repeated (tag attr scan)': fill('<a '),
  '<a:a  repeated': fill('<a:a '),
  '< + 64 word + : + 128 word': fill('<' + 'a'.repeat(64) + ':' + 'b'.repeat(128) + ' '),
  '< + 200 word':fill('<' + 'a'.repeat(200)),
  '<a  + 256 non-> ': fill('<a ' + 'x'.repeat(256)),
  'a://:x@ repeated (url match each 7)': fill('a://:x@'),
  'a://u:x@ repeated': fill('a://u:x@'),
  'a:// + 255 user chars + : + 255 pw chars, no @': fill('a://' + 'u'.repeat(255) + ':' + 'p'.repeat(255) + ' '),
  'a:// + 300 chars no @': fill('a://' + 'x'.repeat(300) + ' '),
  'scheme31:// repeated': fill('a'.repeat(31) + '://'),
  'a://:@@@@ (pw of @)': fill('a://:' + '@'.repeat(250) + ' '),
  'a://: + pw 256 of @x':fill('a://:' + '@x'.repeat(128) + ' '),
  'token  + 1100 letters (no digit)': fill('token ' + 'a'.repeat(1100) + ' '),
  'token 1 + letters': fill('token 1' + 'a'.repeat(1100) + ' '),
  'token 1234567a  repeated (match each 15)': fill('token 1234567a '),
  'bearer    \\t repeated': fill('bearer \t\t\t'),
  '.token .token': fill('.token '),
  'token= letters': fill('token=' + 'a'.repeat(100)),
  'mixed: <a x="1" token 12345678 a://:p@ pass=1': fill('<a x="1"> token 12345678 a://:p@h pass=1 '),
}

const rx = (re, s) => { re.lastIndex = 0; let n = 0; for (const _ of s.matchAll(re)) n++; return n }
console.log('shape'.padEnd(52), 'KEY  TAG  URL  AUTH | url-repl auth-repl | sanitize(text)  sanitize(in JSON)  [matches]')
for (const [name, s] of Object.entries(shapes)) {
  const [k, nk] = ms(() => rx(KEY_IN_TEXT, s))
  const [t, nt] = ms(() => rx(TAG_IN_TEXT, s))
  const [u, nu] = ms(() => rx(URL_USERINFO, s))
  const [a, na] = ms(() => rx(AUTH_VALUE, s))
  const [ur] = ms(() => s.replace(URL_USERINFO, () => 'x'))
  const [ar] = ms(() => s.replace(AUTH_VALUE, () => 'x'))
  const [st, snap] = ms(() => sanitizeSnapshot({ collections: { t: { key: null, rows: [{ note: s }], count: 1 } } }, { masker, rules }))
  const [sj] = ms(() => sanitizeSnapshot({ collections: { t: { key: null, rows: [{ doc: { note: s } }], count: 1 } } }, { masker, rules }))
  const f = x => x.toFixed(0).padStart(4)
  const flag = Math.max(k, t, u, a, ur, ar, st, sj) > 50 ? '  <-- over 50 ms' : ''
  const cell = snap.collections.t.rows[0]?.note
  console.log(name.slice(0, 52).padEnd(52), f(k), f(t), f(u), f(a), '|', f(ur), '    ', f(ar), '    |', f(st), '           ', f(sj), `   [${nk}/${nt}/${nu}/${na}]`, flag, typeof cell === 'object' && cell ? cell.t : typeof cell)
}
