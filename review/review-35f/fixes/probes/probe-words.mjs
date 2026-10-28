// E6: keys that SECRET_NAME matches only as words (pin, pw, psk, auth),
// written plain, after an escape, and percent-encoded, in a neutral field.
import * as E from '../head/data-diff.mjs'
const rules = E.validateRules({})
const masker = E.createMasker({ key: Buffer.alloc(32, 7), rules })
const S = 'hunter2Zq'
const cases = {
  'pw= plain': `pw=${S}`,
  'user_pw= plain': `user_pw=${S}`,
  '{"pw": …} JSON text in prose': `x {"pw": "${S}"}`,
  'pw after a real &': `a=1&pw=${S}`,
  'pw after %26': `next=%2Fx%3Fa%3D1%26pw%3D${S}`,
  '%22pw%22%3A': `s=%7B%22pw%22%3A%22${S}%22%7D`,
  '%22password%22%3A (control)': `s=%7B%22password%22%3A%22${S}%22%7D`,
  'pin after %26': `q=%26pin%3D${S}`,
  '_auth after %0A (npmrc, encoded)': `npmrc=registry%3Dx%0A_auth%3D${S}`,
  'auth after \\n (escaped npmrc)': `registry=x\\n_auth=${S}`,
  'pw after \\n': `a=1\\npw=${S}`,
  'password after \\n (control)': `a=1\\npassword=${S}`,
}
for (const [label, v] of Object.entries(cases)) {
  const [row] = E.sanitizeSnapshot({ collections: { t: { key: null, rows: [{ note: v }] } } }, { masker, rules }).collections.t.rows
  const s = JSON.stringify(row.note)
  console.log(`${s.includes(S) ? 'CLEAR' : 'ok   '} ${label.padEnd(36)} ${s.slice(0, 100)}`)
}
