// The two un-masking shapes at 2ec0bba (round 3's head), 7193877 (round 4's
// review), 4a284f9 (now) and with the proposed one-line fixes.
import * as R3 from '../../review-35d/fixes/old2ec/data-diff.mjs'
import * as OLD from './old/data-diff.mjs'
import * as NEW from './new/data-diff.mjs'
import * as FIX from './fix/data-diff.mjs'
const S = 'Zq9SeCr3tVal'
const cases = {
  'tag, < in an attribute': `<password hint="a<b">${S}</password>`,
  'namespaced tag, < in an attribute': `<wsse:Password Type="a<b">${S}</wsse:Password>`,
  'custom element, < in an attribute': `<secret-note title="x < y">${S}</secret-note>`,
  'self-closing, < in an attribute': `<Password placeholder="<enter>" />${S}`,
  'x%3dpassword=S': `x%3dpassword=${S}`,
  'x%3Apassword: S': `x%3Apassword: ${S}`,
  'value%3aS--db-token=': `value%3a${S}--db-token=`,
  'state%3AStoken%22%3dtoken:': `state%3A${S}token%22%3dtoken:`,
}
const libs = { '2ec0bba': R3, '7193877': OLD, '4a284f9': NEW, 'fix': FIX }
console.log(`${''.padEnd(36)} ${Object.keys(libs).map(k => k.padEnd(8)).join(' ')}`)
for (const [label, v] of Object.entries(cases)) {
  const row = Object.values(libs).map(lib => {
    const rules = lib.validateRules({})
    const masker = lib.createMasker({ key: Buffer.alloc(32, 7), rules })
    const out = JSON.stringify(lib.sanitizeSnapshot({ collections: { c: { key: ['id'], rows: [{ id: 1, note: v }] } } }, { masker, rules }).collections.c.rows[0].note)
    return (out.includes(S) ? 'CLEAR' : 'masked').padEnd(8)
  })
  console.log(`${label.padEnd(36)} ${row.join(' ')}`)
}
