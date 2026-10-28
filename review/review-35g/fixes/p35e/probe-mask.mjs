// E2: value masking at 4a284f9 against 7193877, neutral field names (`note`),
// so only value-side masking is tested. S marks the value that must not show.
import * as NEW from './repo/lib/data-diff.mjs'
import * as OLD from './old79/data-diff.mjs'

const S = 'hunter2Zq'
const tok = ['gh', 'p_'].join('') + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const b64 = Buffer.from(`bot:${S}`).toString('base64')
const triple = JSON.stringify(JSON.stringify(JSON.stringify({ password: S, user: 'a' })))
const cases = {
  // round-4 items claimed fixed
  'url userinfo': [`postgres://app:${S}@db:5432/x`, S],
  'url empty user': [`redis://:${S}@cache:6379`, S],
  'token:x-oauth-basic user': [`https://${tok}:x-oauth-basic@github.com/o/r.git`, tok],
  'token:@ user': [`https://${tok}:@github.com/o/r.git`, tok],
  'token user with a password': [`https://${tok}:pw-${S}@github.com/o/r.git`, [tok, S]],
  'Basic short base64': ['Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
  'basic lower short base64': ['authorization: basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
  'Basic b64 of bot:S': [`Authorization: Basic ${b64}`, b64],
  '&QUOT; upper': [`cfg={&QUOT;password&QUOT;:&QUOT;${S}&QUOT;}`, S],
  '&#X22; upper': [`cfg={&#X22;password&#X22;:&#X22;${S}&#X22;}`, S],
  '&Quot; mixed': [`cfg={&Quot;password&Quot;:&Quot;${S}&Quot;}`, S],
  '&apos;': [`cfg=&apos;password&apos;: &apos;${S}&apos;`, S],
  '&#x27;': [`cfg=&#x27;password&#x27;: &#x27;${S}&#x27;`, S],
  'triple-encoded JSON text': [`log: ${triple}`, S],
  'backtick MySQL log': [`UPDATE \`users\` SET \`password\` = '${S}' WHERE id = 1`, S],
  'backtick markdown': [`\`password\`: ${S}`, S],
  '32 spaces before =': [`password${' '.repeat(32)}= ${S}`, S],
  '33 spaces before = (past bound)': [`password${' '.repeat(33)}= ${S}`, S],
  'tab before =': [`password\t\t= ${S}`, S],
  'password%3D at start': [`password%3D${S}`, S],
  'password%3d lower': [`password%3d${S}`, S],
  '&password%3D (after real &)': [`grant_type=password&username=a&password%3D${S}`, S],
  '%22password%22%3A after =': [`state=%22password%22%3A%22${S}%22`, S],
  'url-encoded JSON object %7B%22password%22%3A': [`/cb?state=%7B%22password%22%3A%22${S}%22%7D`, S],
  'url-encoded JSON, key after %2C': [`/cb?state=%7B%22u%22%3A%22a%22%2C%22password%22%3A%22${S}%22%7D`, S],
  'double-encoded query %26password%3D': [`next=%2Flogin%3Fuser%3Dbob%26password%3D${S}`, S],
  'encoded query %3Fpassword%3D': [`redirect=%2Flogin%3Fpassword%3D${S}`, S],
  'lowercase %7b%22password%22%3a': [`/cb?state=%7b%22password%22%3a%22${S}%22%7d`, S],
  '--password space': [`pg_dump --password ${S} --host db`, S],
  '--password=': [`run --password=${S}`, S],
  '--db-token=': [`run --db-token=${S}`, S],
  '-p glued mysql': [`mysql -uroot -p${S} app`, S],
  '-p glued mysqldump': [`mysqldump -u root -p${S} app > x.sql`, S],
  '-p glued (not mysql)': [`psql -p${S}`, S],
  'Go DSN tcp': [`root:${S}@tcp(127.0.0.1:3306)/app`, S],
  'Go DSN unix': [`root:${S}@unix(/tmp/mysql.sock)/app`, S],
  'Go DSN with @ in password': [`root:p@ss${S}@tcp(127.0.0.1:3306)/app`, S],
  'Go DSN, no protocol': [`root:${S}@/app`, S],
  'Go DSN tcp6': [`root:${S}@tcp6([::1]:3306)/app`, S],
  'JWT': [`token was eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.${S}sig ok`, S],
  'PEM private key': [`-----BEGIN RSA PRIVATE KEY-----\nMIIEow${S}IBAAKCAQEA\n-----END RSA PRIVATE KEY-----`, S],
  'PEM OPENSSH': [`-----BEGIN OPENSSH PRIVATE KEY-----\nb3Bl${S}\n-----END OPENSSH PRIVATE KEY-----`, S],
  'PEM ENCRYPTED': [`-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIF${S}\n-----END ENCRYPTED PRIVATE KEY-----`, S],
  '.NET add key value': [`<add key="DbPassword" value="${S}" />`, S],
  '.NET add value first': [`<add value="${S}" key="DbPassword"/>`, S],
  'input type=password quoted': [`<input type="password" name="x" value="${S}">`, S],
  'input type=password unquoted': [`<input type=password value=${S}>`, S],
  '.NET add value with an apostrophe': [`<add key="DbPassword" value="it's${S}" />`, S],
  '.NET add key, single quotes': [`<add key='DbPassword' value='${S}' />`, S],
  'Spring XML property': [`<property name="password" value="${S}"/>`, S],
  'HTML entity in attr value': [`<add key="DbPassword" value="a&amp;${S}" />`, S],
  'multi-line attrs': [`<add\n  key="DbPassword"\n  value="${S}"\n/>`, S],
}
const json = {
  'HAR cookie 8 keys': [[{ name: 'session', value: S, path: '/', domain: 'x.test', expires: null, httpOnly: true, secure: true, sameSite: 'Lax' }], S],
  'SSM Parameter': [{ Parameter: { Name: '/prod/db-password', Type: 'SecureString', Value: S, Version: 1, LastModifiedDate: '2026-01-01', ARN: 'arn:x', DataType: 'text' } }, S],
  '{name:password, value, +5}': [[{ name: 'password', value: S, a: 1, b: 2, c: 3, d: 4, e: 5 }], S],
  'two value keys': [[{ name: 'password', value: S, v: `${S}2` }], [S, `${S}2`]],
  '{key: password, value, +10}': [[{ key: 'password', value: S, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 }], S],
  '{Key: api_token, Value, +5}': [[{ Key: 'api_token', Value: S, a: 1, b: 2, c: 3, d: 4, e: 5 }], S],
  'loose {k, v} 6 keys': [[{ k: 'password', v: S, a: 1, b: 2, c: 3, d: 4 }], S],
  'loose {k, v} 7 keys (bounded)': [[{ k: 'password', v: S, a: 1, b: 2, c: 3, d: 4, e: 5 }], S],
  'loose {NAME, VALUE} 7 keys (bounded)': [[{ NAME: 'password', VALUE: S, a: 1, b: 2, c: 3, d: 4, e: 5 }], S],
  'mixed {name, Value} 7 keys (bounded)': [[{ name: 'password', Value: S, a: 1, b: 2, c: 3, d: 4, e: 5 }], S],
  'name key after a neutral key': [[{ key: 'mail.smtp', name: 'Password', value: S }], S],
  'name key after a neutral k': [[{ k: 'row-17', name: 'password', value: S }], S],
  'nested value object': [[{ name: 'password', value: { inner: S } }], S],
  'K8s env': [{ env: [{ name: 'DB_PASSWORD', value: S }, { name: 'HOST', value: 'db' }] }, S],
}
const neutral = {
  'prose Basic': 'Basic introduction to the topic',
  'prose Basic Introduction': 'Basic Introduction',
  'prose basic plan': 'Basic plan: 10GB storage',
  'mkdir -p': 'mkdir -p /var/lib/app && gcc -pthread x.c',
  'author key': 'author=jane',
  'plain url': 'https://app:pw@db',
  'non-token user': 'https://alice:secretpw@host/x',
  'rawHeaders-like roles': ['viewer', 'session_manager', 'admin'],
  'ssh git@': 'ssh://git@github.com/o/r.git',
}
const mk = lib => {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: Buffer.alloc(32, 7), rules })
  return c => lib.sanitizeSnapshot({ collections: c }, { masker, rules })
}
const res = {}
for (const [label, lib] of [['new', NEW], ['old', OLD]]) {
  const snap = mk(lib)
  res[label] = {}
  for (const [k, [v, secret]] of [...Object.entries(cases), ...Object.entries(json)]) {
    const [row] = snap({ t: { key: null, rows: [{ note: v }], count: 1 } }).collections.t.rows
    const s = JSON.stringify(row.note)
    const leak = (Array.isArray(secret) ? secret : [secret]).filter(x => s.includes(x))
    res[label][k] = [leak.length ? 'CLEAR' : 'ok', s.slice(0, 140)]
  }
  for (const [k, v] of Object.entries(neutral)) {
    const [row] = snap({ t: { key: null, rows: [{ note: v }], count: 1 } }).collections.t.rows
    res[label][`neutral: ${k}`] = ['-', JSON.stringify(row.note).slice(0, 140)]
  }
}
for (const k of Object.keys(res.new)) {
  const [n, ns] = res.new[k]
  const [o] = res.old[k]
  const tag = n === 'CLEAR' && o === 'ok' ? ' REGRESSION' : n === 'ok' && o === 'CLEAR' ? ' (fixed)' : ''
  console.log(`${n.padEnd(5)} old:${o.padEnd(5)} ${k.padEnd(46)} ${ns}${tag}`)
}
