// Corpus regression: each case's secret, masked or in clear, at 7193877
// (old) and 4a284f9 (new). Neutral field names unless a case says otherwise.
// Reports: REGRESSION (masked old, clear new), FIXED (clear old, masked new),
// CLEAR-BOTH, ok.
import * as NEW from './fix/data-diff.mjs'
import * as OLD from './old/data-diff.mjs'

const KEY = Buffer.alloc(32, 7)
const mk = lib => {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  return collections => lib.sanitizeSnapshot({ collections }, { masker, rules })
}
const S = 'Zq9SeCr3tVal'
const tok = ['gh', 'p_'].join('') + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const b64 = Buffer.from(`bot:${S}`).toString('base64')
// [value, secrets...] ; value may be a string or object; field name optional via {field}
const cases = {
  // round-3/4 probe-d2
  empty_user: ['cache at redis://:redis-pw-9@cache:6379/0', 'redis-pw-9'],
  at_in_pw: ['postgres://app:p@ss-word-9@db:5432/app', 'ss-word-9'],
  u_alone: [`git remote https://${tok}@github.com/o/r.git`, tok],
  u_user_x_oauth: [`git remote https://${tok}:x-oauth-basic@github.com/o/r.git`, tok],
  u_user_empty_pw: [`https://${tok}:@github.com/o/r.git`, tok],
  scheme_lower: ['sent header bearer abcdefghij123456 ok', 'abcdefghij123456'],
  scheme_upper: ['BEARER abcdefghij123456', 'abcdefghij123456'],
  scheme_mixed: ['BeArEr abcdefghij123456', 'abcdefghij123456'],
  basic_short_b64: ['auth=Basic dXNlcjpwYXNz ok', 'dXNlcjpwYXNz'],
  basic_b64_pad: ['auth=Basic YWRtaW46YWRtaW4= ok', 'YWRtaW46YWRtaW4='],
  basic_header_only: ['Authorization header: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
  scheme_short_alpha: ['send Token abcdefghij to it', 'abcdefghij'],
  wsse: ['<soap:Header><wsse:Password Type="PasswordText">soap-secret-9</wsse:Password></soap:Header>', 'soap-secret-9'],
  xml_attr: ['<password type="text">attr-secret-9</password>', 'attr-secret-9'],
  html_quot: ['data-config="{&quot;password&quot;:&quot;html-secret-9&quot;}"', 'html-secret-9'],
  html_34: ['data-config="{&#34;password&#34;:&#34;html-secret-8&#34;}"', 'html-secret-8'],
  html_x22: ['data-config="{&#x22;password&#x22;:&#x22;html-secret-7&#x22;}"', 'html-secret-7'],
  html_X22_upper: ['data-config="{&#X22;password&#X22;:&#X22;html-secret-6&#X22;}"', 'html-secret-6'],
  html_QUOT_upper: ['data-config="{&QUOT;password&QUOT;:&QUOT;html-secret-5&QUOT;}"', 'html-secret-5'],
  newline_key: ['log line\\npassword=hunter2', 'hunter2'],
  win_path_key: ['C:\\Users\\x\\api_key=abc123', 'abc123'],
  spaced: ['password : spaced-secret-9', 'spaced-secret-9'],
  // probe-mask shapes
  url_userinfo: [`postgres://app:${S}@db:5432/x`, S],
  url_empty_user: [`redis://:${S}@cache:6379`, S],
  bearer: [`Authorization header was Bearer ${S}abcdefgh`, S],
  key_eq: [`password=${S}`, S],
  esc_quotes: [`{\\"password\\": \\"${S}\\"}`, S],
  tag_ns: [`<wsse:Password Type="x">${S}</wsse:Password>`, S],
  yaml: [`db:\n  password: ${S}\n`, S],
  mysql_backtick: [`UPDATE \`users\` SET \`password\` = '${S}' WHERE id = 1`, S],
  md_inline: [`\`password\`: ${S}`, S],
  cli_flag_space: [`pg_dump --password ${S} --host db`, S],
  cli_p_glued: [`mysql -uroot -p${S} app`, S],
  go_dsn: [`root:${S}@tcp(127.0.0.1:3306)/app`, S],
  url_raw_slash: [`postgres://app:${S}/x@db/app`, S],
  jwt: [`eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIke1NFQ1JFVH0ifQ.${S}sig`, S],
  form_body: [`grant_type=password&username=a&password%3D${S}`, S],
  pct_json: [`/cb?state=%7B%22password%22%3A%22${S}%22%7D`, S],
  dotnet_add: [`<add key="DbPassword" value="${S}" />`, S],
  html_input: [`<input type="password" name="pw" value="${S}">`, S],
  aligned10: [`password          = ${S}`, S],
  sql_insert: [`INSERT INTO users (email, password) VALUES ('a@x', '${S}')`, S],
  pem: [`-----BEGIN RSA PRIVATE KEY-----\nMIIEow${S}IBAAKCAQEA\n-----END RSA PRIVATE KEY-----`, S],
  // new probes of my own
  tag_attr_lt: [`<password hint="a<b">${S}</password>`, S],
  tag_attr_lt_ns: [`<wsse:Password Type="a<b">${S}</wsse:Password>`, S],
  tag_attr_lt_jsx: [`<Password placeholder="<enter>" />${S}`, S],
  tag_attr_lt_html: [`<secret data-tip="x < y">${S}</secret>`, S],
  attr_tag_lt: [`<add key="DbPassword" note="a<b" value="${S}" />`, S],
  pct_eq_then_key: [`x%3dpassword=${S}`, S],
  pct_colon_then_key: [`x%3Apassword: ${S}`, S],
  pct_eq_then_key_json: [`q%3Dtoken%3D${S}`, S],
  pct_amp_form: [`next=%2Fcb%3Fstate%3Dabc%26password%3D${S}`, S],
  pgp_private: [`-----BEGIN PGP PRIVATE KEY BLOCK-----\n${S}\n-----END PGP PRIVATE KEY BLOCK-----`, S],
  flag_tab: [`pg_dump --password\t${S} --host db`, S],
  flag_newline: [`run --token\n${S}`, S],
  url_user_pw_both_tok: [`https://${tok}:${S}@github.com/`, S, tok],
  url_empty_pw_user_plain: [`https://admin:@host/`, 'admin'],
  auth_lower_token: [`token ${S}`, S],
  auth_alpha16: ['Bearer abcdefghijklmnop', 'abcdefghijklmnop'],
  auth_alpha_12: ['Bearer abcdefghijkl', 'abcdefghijkl'],
  basic_alpha_8: ['Basic abcdABCD', 'abcdABCD'],
  dsn_udp: [`u:${S}@udp(1.2.3.4)`, S],
  jwt_in_json_str: [{ note: `token is eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.${S}` }, S],
  ndjson: [`{"a":1}\n{"password":"${S}"}`, S],
  ndjson_bad_first: [`not json\n{"password":"${S}"}`, S],
  dbl: [JSON.stringify(JSON.stringify({ password: S })), S],
  triple: [JSON.stringify(JSON.stringify(JSON.stringify({ password: S }))), S],
  triple_in_text: [`log: ${JSON.stringify(JSON.stringify(JSON.stringify({ password: S })))}`, S],
  npm_auth: [`registry=https://r.example\n_auth=${b64}`, b64],
  key_backtick_space: [`\`api_key\`    :   ${S}`, S],
  // JSON objects
  aws_name: [[{ Name: 'db-password', Value: 'aws-secret-9' }], 'aws-secret-9'],
  aws_key: [[{ Key: 'api_token', Value: 'tag-secret-9' }], 'tag-secret-9'],
  field_val: [[{ field: 'password', val: 'fv-secret-9' }], 'fv-secret-9'],
  k_v: [[{ k: 'password', v: 'kv-secret-9' }], 'kv-secret-9'],
  NAME_VALUE_upper: [[{ NAME: 'password', VALUE: 'upper-secret-9' }], 'upper-secret-9'],
  pair_7_keys: [[{ name: 'password', value: 'seven-secret-9', a: 1, b: 2, c: 3, d: 4, e: 5 }], 'seven-secret-9'],
  harlog: [[{ name: 'session', value: 'har-cookie-9', path: '/', domain: 'x.test', expires: null, httpOnly: true, secure: true, sameSite: 'Lax' }], 'har-cookie-9'],
  ssm_param: [{ Parameter: { Name: '/prod/db-password', Type: 'SecureString', Value: 'ssm-secret-9', Version: 1, LastModifiedDate: '2026-01-01', ARN: 'arn:x', DataType: 'text' } }, 'ssm-secret-9'],
  pair_two_values: [[{ name: 'password', value: 'v1-secret-9', v: 'v2-secret-9' }], 'v1-secret-9', 'v2-secret-9'],
  pair_name_second: [[{ field: 'x', name: 'password', value: S }], S],
  pair_key_first_nonsecret: [[{ k: 'id', key: 'api_token', value: S }], S],
  pair_name_null_key_secret: [[{ name: null, key: 'password', value: S }], S],
  pair_Name_lower_value: [[{ Name: 'password', value: S, a: 1, b: 2, c: 3, d: 4, e: 5 }], S],
  pair_name_numeric_then_key: [[{ name: 7, key: 'password', value: S }], S],
  pair_value_obj: [[{ name: 'password', value: { inner: S } }], S],
  raw_headers: [['Authorization', `Bearer ${S}`, 'X-Api-Key', S], S],
  // field-name cases (row object, not a cell)
}
const rowCases = {
  col_pw: [{ pw: S }, S],
  col_psk: [{ psk: S }, S],
  col_auth: [{ auth: b64 }, b64],
  col__auth: [{ _auth: b64 }, b64],
  col_Auth: [{ Auth: b64 }, b64],
  col_AUTH_upper: [{ AUTH: b64 }, b64],
  col_auth_token: [{ auth_token: S }, S],
  col_key: [{ key: `sk_live_${S}` }, S],
  docker_auths: [{ config: { auths: { 'ghcr.io': { auth: b64 } } } }, b64],
  json_user_pw: [{ creds_json: { user: 'admin', pw: S } }, S],
}
const results = {}
for (const [label, lib] of [['old', OLD], ['new', NEW]]) {
  const snap = mk(lib)
  for (const [k, [v, ...secrets]] of Object.entries(cases)) {
    const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, note: v }] } }).collections.c.rows
    const s = JSON.stringify(row.note)
    ;(results[k] ??= {})[label] = { leak: secrets.filter(x => s.includes(x)), s }
  }
  for (const [k, [r, ...secrets]] of Object.entries(rowCases)) {
    const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...r }] } }).collections.c.rows
    const s = JSON.stringify(row)
    ;(results[k] ??= {})[label] = { leak: secrets.filter(x => s.includes(x)), s }
  }
}
const tally = {}
for (const [k, { old, new: nu }] of Object.entries(results)) {
  const tag = old.leak.length === 0 && nu.leak.length > 0 ? 'REGRESSION' : old.leak.length > 0 && nu.leak.length === 0 ? 'FIXED' : nu.leak.length ? 'CLEAR-BOTH' : 'ok'
  tally[tag] = (tally[tag] ?? 0) + 1
  console.log(`${tag.padEnd(10)} ${k.padEnd(28)} new ${nu.s.slice(0, 110)}${tag === 'REGRESSION' ? `\n           old ${old.s.slice(0, 110)}` : ''}`)
}
console.log(tally)
