// (4) Common shapes of a secret in a neutrally named field: does the secret
// itself show in the kept cell? SECRET marks the value that must not show.
import { createMasker, sanitizeSnapshot, validateRules } from './repo/lib/data-diff.mjs'
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const SECRET = 'hunter2Zq'
const cases = {
  // claimed by the README: should all be masked
  'url userinfo': `postgres://app:${SECRET}@db:5432/x`,
  'url empty user': `redis://:${SECRET}@cache:6379`,
  'bearer': `Authorization header was Bearer ${SECRET}abcdefgh`,
  'key=': `password=${SECRET}`,
  'key in escaped quotes': `{\\"password\\": \\"${SECRET}\\"}`,
  'tag with ns': `<wsse:Password Type="x">${SECRET}</wsse:Password>`,
  'yaml': `db:\n  password: ${SECRET}\n`,
  // common shapes past the README's list
  'MySQL backticked column (general log)': `UPDATE \`users\` SET \`password\` = '${SECRET}' WHERE id = 1`,
  'Markdown inline code key': `\`password\`: ${SECRET}`,
  'CLI flag, space': `pg_dump --password ${SECRET} --host db`,
  'CLI -p glued': `mysql -uroot -p${SECRET} app`,
  'Go DSN user:pw@tcp(...)': `root:${SECRET}@tcp(127.0.0.1:3306)/app`,
  'URL with raw / in password': `postgres://app:${SECRET}/x@db/app`,
  'JWT in plain text': `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIke1NFQ1JFVH0ifQ.${SECRET}sig`,
  'URL-encoded form body': `grant_type=password&username=a&password%3D${SECRET}`,
  'percent-encoded JSON in a URL': `/cb?state=%7B%22password%22%3A%22${SECRET}%22%7D`,
  '.NET appSettings add key/value': `<add key="DbPassword" value="${SECRET}" />`,
  'HTML input value': `<input type="password" name="pw" value="${SECRET}">`,
  'aligned config, 10 spaces': `password          = ${SECRET}`,
  'Basic, 12 chars, no digit (user:pass)': `Authorization header: Basic dXNlcjpwYXNz`,
  'pair of 7 keys': { label: 'DB password', name: 'DB_PASSWORD', type: 'secret', value: SECRET, required: true, help: 'x', order: 1 },
  'SQL insert by position': `INSERT INTO users (email, password) VALUES ('a@x', '${SECRET}')`,
  'PEM private key': `-----BEGIN RSA PRIVATE KEY-----\nMIIEow${SECRET}IBAAKCAQEA\n-----END RSA PRIVATE KEY-----`,
}
for (const [label, value] of Object.entries(cases)) {
  const snap = sanitizeSnapshot({ collections: { t: { key: null, rows: [{ note: value }], count: 1 } } }, { masker, rules })
  const kept = JSON.stringify(snap.collections.t.rows[0].note)
  const clear = label.startsWith('Basic') ? kept.includes('dXNlcjpwYXNz') : kept.includes(SECRET)
  console.log(`${clear ? 'IN CLEAR' : 'masked  '}  ${label.padEnd(40)} ${kept.slice(0, 110)}`)
}
