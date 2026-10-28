// D2: the round-3 masking low, the double-encoding low and over-masking, at
// 7193877, with 2ec0bba alongside. Neutral field names, so only value-side
// masking is tested.
import * as NEW from './repo/lib/data-diff.mjs'
import * as OLD from './old2ec/data-diff.mjs'

const KEY = Buffer.alloc(32, 7)
const mk = lib => {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  return { rules, snap: collections => lib.sanitizeSnapshot({ collections }, { masker, rules }) }
}
const tok = ['gh', 'p_'].join('') + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const cases = {
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
}
const json = {
  aws_name: [[{ Name: 'db-password', Value: 'aws-secret-9' }], 'aws-secret-9'],
  aws_key: [[{ Key: 'api_token', Value: 'tag-secret-9' }], 'tag-secret-9'],
  field_val: [[{ field: 'password', val: 'fv-secret-9' }], 'fv-secret-9'],
  k_v: [[{ k: 'password', v: 'kv-secret-9' }], 'kv-secret-9'],
  NAME_VALUE_upper: [[{ NAME: 'password', VALUE: 'upper-secret-9' }], 'upper-secret-9'],
  pair_7_keys: [[{ name: 'password', value: 'seven-secret-9', a: 1, b: 2, c: 3, d: 4, e: 5 }], 'seven-secret-9'],
  harlog: [[{ name: 'session', value: 'har-cookie-9', path: '/', domain: 'x.test', expires: null, httpOnly: true, secure: true, sameSite: 'Lax' }], 'har-cookie-9'],
  ssm_param: [{ Parameter: { Name: '/prod/db-password', Type: 'SecureString', Value: 'ssm-secret-9', Version: 1, LastModifiedDate: '2026-01-01', ARN: 'arn:x', DataType: 'text' } }, 'ssm-secret-9'],
  pair_two_values: [[{ name: 'password', value: 'v1-secret-9', v: 'v2-secret-9' }], ['v1-secret-9', 'v2-secret-9']],
}
for (const [label, lib] of [['7193877', NEW], ['2ec0bba', OLD]]) {
  const { snap } = mk(lib)
  console.log(`=== ${label}`)
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...Object.fromEntries(Object.entries(cases).map(([k, [v]]) => [k, v])), ...Object.fromEntries(Object.entries(json).map(([k, [v]]) => [k, v])) }] } }).collections.c.rows
  for (const [k, [, secret]] of [...Object.entries(cases), ...Object.entries(json)]) {
    const s = JSON.stringify(row[k])
    const leak = (Array.isArray(secret) ? secret : [secret]).filter(x => s.includes(x))
    console.log(`${leak.length ? 'CLEAR' : 'ok   '} ${k.padEnd(22)} ${s.slice(0, 130)}`)
  }
  const prose = {
    basic: 'Basic introduction to the topic of this article',
    tok_prose: 'Token expired again',
    holders: 'Token holders of record were notified',
    ssh: 'ssh://git@github.com/o/r.git',
    roles: ['viewer', 'session_manager', 'admin'],
    scheme_prose: 'bearer bonds issued in 2024',
    basic2: 'Basic plan: 10GB storage for everyone',
  }
  const [p] = snap({ c: { key: ['id'], rows: [{ id: 1, ...prose }] } }).collections.c.rows
  for (const k of Object.keys(prose)) console.log(`prose ${k.padEnd(8)} ${JSON.stringify(p[k])}`)
}

console.log('\n=== double encoding (enc: 2)')
for (const [label, lib] of [['7193877', NEW], ['2ec0bba', OLD]]) {
  const { snap, rules } = mk(lib)
  const one = '{"theme":"dark","n":1}'
  const big = JSON.stringify({ theme: 'dark', blob: 'x'.repeat(300) })
  const rows = v => ({ prefs: { key: ['id'], rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, data: v })) } })
  for (const [what, from, to] of [
    ['plain -> double (short)', one, JSON.stringify(one)],
    ['plain -> double (long)', big, JSON.stringify(big)],
    ['object -> double', JSON.parse(one), JSON.stringify(one)],
    ['object -> plain text', JSON.parse(one), one],
    ['double -> triple', JSON.stringify(one), JSON.stringify(JSON.stringify(one))],
    ['plain -> double, padded with spaces', one, `  ${JSON.stringify(one)}`],
  ]) {
    const s0 = snap(rows(from))
    const s1 = snap(rows(to))
    const pr = lib.diffSnapshots(s0, s1)
    const flags = lib.flagChanges(lib.diffSnapshots(s0, s0), pr, rules, { trusted: true })
    console.log(`${label} ${what.padEnd(36)} updated ${pr.collections.prefs.updated.length}, flags ${JSON.stringify(flags.map(f => [f.kind, f.severity]))}, cells ${JSON.stringify(s0.collections.prefs.rows[0].data).slice(0, 60)} | ${JSON.stringify(s1.collections.prefs.rows[0].data).slice(0, 80)}`)
  }
}
{
  const { snap } = mk(NEW)
  const dbl = JSON.stringify(JSON.stringify({ password: 'dbl-secret', user: 'a' }))
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, dbl, nested: { inner: dbl }, triple: JSON.stringify(dbl) }] } }).collections.c.rows
  for (const k of ['dbl', 'nested', 'triple']) console.log(`${JSON.stringify(row[k]).includes('dbl-secret') ? 'CLEAR' : 'ok   '} double-encoded secret ${k}: ${JSON.stringify(row[k]).slice(0, 120)}`)
}
