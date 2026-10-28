// (4) Field and key names SECRET_NAME misses, in common shapes.
import { createMasker, sanitizeSnapshot, validateRules, SECRET_NAME } from './repo/lib/data-diff.mjs'
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const SECRET = 'hunter2Zq'
const rows = {
  'column pw': { pw: SECRET },
  'JSON {user, pw}': { creds_json: { user: 'admin', pw: SECRET } },
  'Docker config auths.*.auth': { config: { auths: { 'ghcr.io': { auth: Buffer.from(`bot:${SECRET}`).toString('base64') } } } },
  'npm _auth line': { npmrc: `registry=https://r.example\n_auth=${Buffer.from(`bot:${SECRET}`).toString('base64')}` },
  'column key (Stripe key)': { key: `sk_live_${SECRET}` },
  'column psk': { psk: SECRET },
}
for (const [label, row] of Object.entries(rows)) {
  const snap = sanitizeSnapshot({ collections: { t: { key: null, rows: [row], count: 1 } } }, { masker, rules })
  const kept = JSON.stringify(snap.collections.t.rows[0])
  const b64 = Buffer.from(`bot:${SECRET}`).toString('base64')
  const clear = kept.includes(SECRET) || kept.includes(b64)
  console.log(`${clear ? 'IN CLEAR' : 'masked  '}  ${label.padEnd(28)} ${kept.slice(0, 120)}`)
}
console.log('SECRET_NAME on pw, auth, _auth, key, psk:', ['pw', 'auth', '_auth', 'key', 'psk'].map(n => SECRET_NAME.test(n)))
