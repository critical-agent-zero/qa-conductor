// Smallest reproducers for each regression class, in field `note`, at every
// head. CLEAR = a listed secret shows in the kept cell.
import { maskValues, maskRows, HEAD_NAMES, NEW } from './h.mjs'

const S = 'Zq9SeCr3tVal'
const jwt = n => `eyJhbGciOiJSUzI1NiJ9.eyJ${'c3ViIjoiMTIzNDU2Nzg5MCJ9'.repeat(Math.ceil(n / 24)).slice(0, n)}.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV`
export const CASES = {
  // E1: the element rule runs before JWT and DSN now, so its 1024-character
  // tag bound counts their raw length
  e1_jwt_attr: [`<input type="password" value="${S}" data-x="${jwt(1000)}">`, S],
  e1_jwt_attr_min: [`<i type=password value=${S} a=${jwt(990)}>`, S],
  e1_add_jwt: [`<add key="ClientSecret" value="${S}" note="${jwt(1000)}"/>`, S],
  e1_dsn_attrs: [`<add key="DbPassword" value="${S}" a="u:${'p'.repeat(256)}@tcp(h)" b="u:${'p'.repeat(256)}@tcp(h)" c="u:${'p'.repeat(256)}@tcp(h)" d="u:${'p'.repeat(256)}@tcp(h)"/>`, S],
  // E2: a DSN password holding '<' or '>' in another attribute of a secret element
  e2_dsn_lt: [`<add key="DbPassword" value="${S}" note="u:a<b@tcp(h)/d"/>`, S],
  e2_dsn_gt: [`<input type="password" value="${S}" data-c="app:p>w@/db">`, S],
  // E3: a DSN starting inside a secret element's value, its password across the '>'
  e3_unquoted: [`<input type=password value=root:ab>${S}@tcp(db)/app`, S],
  e3_slash: [`<x name=secret value=u:p>${S}@/db`, S],
  // A1: a scheme's token value now swallows the scheme word that named the next token
  a1_rescan: [`Bearer ab/token x1/token ${S}`, S],
  a1_rescan_hdr: [`Authorization header: Bearer ab/token x1/token ${S}`, S],
  // P1 (since 4ed6449): an empty name-like attribute takes the next attribute's name as its value
  p1_empty_type: [`<input type= name="password" value="${S}">`, S],
  p1_key_key: [`<add key=key="ApiToken" value="${S}" />`, S],
  // P2 (since 4a284f9): a Basic value that reads as base64 swallows the next scheme word
  p2_basic_bearer: [`Basic //bearer ${S}`, S],
  p2_basic_token: [`Basic ab12/token ${S}`, S],
  // P3 (vs 4a284f9 only): a scheme's value is a DSN's user, so the DSN rule can't anchor
  p3_scheme_dsn: [`x/token //bearer HX4coiQx:${S}:t9Gk@tcp(h)/d`, S],
  // P4 (vs 7193877): an escape's hex digit read as a key's first letter
  p4_hex_key: [`A%3API_KEY='${S}'`, S],
  p4_hex_dsn: [`x%3DSN_URL=${S}`, S],
  // P5 (vs 2ec0bba, by design since 7193877): a short digit-free scheme value
  p5_short: ['Bearer abcdefGHIJ', 'abcdefGHIJ'],
}
export const ROWS = {
  r1_key_value: [{ key: ['key', 'value'], rows: [{ key: 'smtp_password', value: S }] }, S],
  r1_all_columns: [{ key: ['id', 'name', 'value'], rows: [{ id: 1, name: 'STRIPE_SECRET_KEY', value: S }] }, S],
  r1_k_v: [{ key: ['k', 'v'], rows: [{ k: 'api_token', v: S }] }, S],
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = Object.keys(CASES)
  const out = maskValues(names.map(n => CASES[n][0]))
  for (const [i, n] of names.entries()) {
    const secrets = CASES[n].slice(1)
    console.log(`${n.padEnd(16)} ${HEAD_NAMES.map(h => `${h}:${secrets.some(s => out[h][i].includes(s)) ? 'CLEAR ' : 'masked'}`).join(' ')}  len=${CASES[n][0].length}`)
    if (process.argv[2] === '-v') console.log(`   head: ${out[NEW][i].slice(0, 220)}`)
  }
  for (const [n, [{ key, rows }, ...secrets]] of Object.entries(ROWS)) {
    const o = maskRows(rows, { key })
    console.log(`${n.padEnd(16)} ${HEAD_NAMES.map(h => `${h}:${secrets.some(s => o[h][0].includes(s)) ? 'CLEAR ' : 'masked'}`).join(' ')}`)
    if (process.argv[2] === '-v') console.log(`   head: ${o[NEW][0]}`)
  }
}
