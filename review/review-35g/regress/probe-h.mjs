// Targeted probes for this round's changes: the reordered text rules, the
// scheme rescan, the DSN class with ':', and pair rows' key fields.
import { maskValues, maskRows, HEAD_NAMES, NEW } from './h.mjs'

const S = 'Zq9SeCr3tVal'
const jwtBody = n => 'eyJhbGciOiJSUzI1NiJ9.eyJ' + 'QWxhZGRpbjpvcGVuIHNlc2FtZQ'.repeat(Math.ceil(n / 26)).slice(0, n) + '.c2lnbmF0dXJlX19fX19fX19fX18'
const cells = {
  // H1 scheme rescan: a scheme word ending a non-token value, then a real one
  h1_rescan: [`Bearer ab/token x1/token ${S}`, S],
  h1_rescan_basic: [`token ab/bearer xyz98765/bearer ${S}`, S],
  h1_rescan_hdr: [`got Bearer abc/Token Q1w2E3r4/bearer ${S}x`, S],
  // H2 element first: an unquoted element value holding a DSN whose password has '>'
  h2_elem_dsn_gt: [`<input type=password value=root:ab>${S}@tcp(db)/app`, S],
  h2_elem_dsn_gt_slash: [`<x name=secret value=u:p>${S}@/db`, S],
  // H8 element first: the tag's 1024-character bound now counts a JWT or a
  // DSN the later rules would have shortened
  h8_jwt_1000: [`<input type="password" name="pw" value="${S}" data-state="${jwtBody(1000)}">`, S],
  h8_jwt_1100: [`<input type="hidden" name="api_token" value="${S}" data-claims="${jwtBody(1100)}">`, S],
  h8_jwt_before: [`<input data-claims="${jwtBody(1100)}" type="password" value="${S}">`, S],
  h8_add_jwt: [`<add key="ClientSecret" value="${S}" note="${jwtBody(1050)}"/>`, S],
  h8_dsn_4x: [`<add key="DbPassword" value="${S}" a="u:${'p'.repeat(250)}@tcp(h)" b="u:${'p'.repeat(250)}@tcp(h)" c="u:${'p'.repeat(250)}@tcp(h)" d="u:${'p'.repeat(250)}@tcp(h)"/>`, S],
  h8_url_jwt_mix: [`<input type="password" value="${S}" src="https://cdn/x" data-a="${jwtBody(600)}" data-b="${jwtBody(600)}">`, S],
  // H4 DSN window: an inner '@(' inside a DSN password, its real end past 256
  h4_window: [`t:${'a'.repeat(200)};root:pw@(${S}@tcp(h)/db`, S],
}
const vals = Object.values(cells).map(c => c[0])
const out = maskValues(vals)
const names = Object.keys(cells)
for (let i = 0; i < names.length; i++) {
  const [, ...secrets] = cells[names[i]]
  const row = HEAD_NAMES.map(h => (secrets.some(s => out[h][i].includes(s)) ? 'CLEAR' : 'masked'))
  console.log(`${names[i].padEnd(22)} ${HEAD_NAMES.map((h, k) => `${h}:${row[k]}`).join(' ')}`)
  if (row[4] === 'CLEAR') console.log(`   head: ${out[NEW][i].slice(0, 260)}`)
  if (row[3] !== row[4]) console.log(`   4ed6449: ${out['4ed6449'][i].slice(0, 260)}`)
}

// H3: pair rows whose value field is one of the collection's key fields
console.log('\n-- pair rows, value field in the key')
const pairCases = [
  { key: ['key', 'value'], rows: [{ key: 'smtp_password', value: S }] },
  { key: ['name', 'value'], rows: [{ name: 'STRIPE_SECRET_KEY', value: S }] },
  { key: ['k', 'v'], rows: [{ k: 'api_token', v: S }] },
  { key: ['id', 'value'], rows: [{ id: 1, key: 'db_password', value: S }] },
  { key: ['Key', 'Value'], rows: [{ Key: 'DbPassword', Value: S }] },
  { key: ['value'], rows: [{ name: 'session_secret', value: S }] },
  { key: ['id'], rows: [{ id: 1, key: 'smtp_password', value: S }] },
]
for (const c of pairCases) {
  const o = maskRows(c.rows, { key: c.key })
  console.log(JSON.stringify(c.key).padEnd(18), HEAD_NAMES.map(h => `${h}:${o[h][0].includes(S) ? 'CLEAR' : 'masked'}`).join(' '))
  console.log('   head:', o[NEW][0], ' 4ed6449:', o['4ed6449'][0])
}
