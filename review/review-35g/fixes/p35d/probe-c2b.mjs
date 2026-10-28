// C2b: the cases from C2 whose field names happened to look secret, again
// under neutral field names, so only the value-side masking is tested.
import { createMasker, sanitizeSnapshot, validateRules } from './repo/lib/data-diff.mjs'
const KEY = Buffer.alloc(32, 7)
const rules = validateRules({})
const snap = collections => sanitizeSnapshot({ collections }, { masker: createMasker({ key: KEY, rules }), rules })
const cases = {
  f1: ['git remote https://ghp_AAAABBBBCCCCDDDDEEEE@github.com/o/r.git', 'ghp_AAAABBBBCCCCDDDDEEEE'],
  f2: ['sent header bearer abcdefghij123456 ok', 'abcdefghij123456'],
  f3: ['BEARER abcdefghij123456', 'abcdefghij123456'],
  f4: ['{:password=>"ruby-secret-9"}', 'ruby-secret-9'],
  f5: [new Map([['password', 'map-secret-9']]), 'map-secret-9'],
  f6: [['set-cookie', 'sid=cookie-list-9'], 'cookie-list-9'],
  f7: [['Authorization', 'Bearer short'], 'short'],
  f8: ['Authorization: Bearer xyz', 'xyz'],
  f9: ['curl -H "X-Api-Key: live-key-999" https://x', 'live-key-999'],
  f10: ['mongodb+srv://admin:mongo-pw-9@cluster0.x.net/db', 'mongo-pw-9'],
  f11: ['amqp://guest:amqp-pw-9@rabbit:5672', 'amqp-pw-9'],
  f12: ['jdbc:postgresql://db/app?user=app&password=jdbc-pw-9', 'jdbc-pw-9'],
  f13: ['Server=db;User Id=sa;Password=mssql-pw-9;', 'mssql-pw-9'],
}
const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...Object.fromEntries(Object.entries(cases).map(([k, [v]]) => [k, v])) }] } }).collections.c.rows
for (const [k, [v, secret]] of Object.entries(cases)) {
  const s = JSON.stringify(row[k])
  console.log(`${s.includes(secret) ? 'LEAK' : 'ok  '} ${k} ${JSON.stringify(v instanceof Map ? [...v] : v).slice(0, 60)} -> ${s.slice(0, 140)}`)
}
