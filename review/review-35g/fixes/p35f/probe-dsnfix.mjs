// DSN shapes at 4a284f9, head and fix/ (password class [^\s/]), and the
// cost of a 256 KB 'a:' cell (CPU, best of 3).
import * as R5 from '../old4a/data-diff.mjs'
import * as H from '../head/data-diff.mjs'
import * as F from '../fix/lib/data-diff.mjs'
const S = 'Zq9SeCr3tVal'
const cases = {
  'colon in the middle': `root:pa:${S}@tcp(127.0.0.1:3306)/app`,
  'colon after the secret': `root:${S}:x9@tcp(db:3306)/app`,
  'ending in a colon': `root:${S}:@tcp(db)/app`,
  'unix, colon': `app:${S}:k@unix(/tmp/mysql.sock)/db`,
  'log line': `connecting with root:${S}:x@tcp(10.0.0.5:3306)/orders?parseTime=true`,
  'fuzz sample': `a://Bearer &QUOT;a%22:${S}root:@tcp(h)<a `,
  '@ in password': `root:p@ss${S}@tcp(127.0.0.1:3306)/app`,
  '@/': `root:${S}@/app`,
  'cloudsql': `root:${S}@cloudsql(project:region:instance)/app`,
}
for (const [label, lib] of [['4a284f9', R5], ['4ed6449', H], ['fix', F]]) {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: Buffer.alloc(32, 7), rules })
  const snap = r => lib.sanitizeSnapshot({ collections: { c: { key: ['id'], rows: r } } }, { masker, rules })
  const [row] = snap([{ id: 1, ...cases }]).collections.c.rows
  const leaks = Object.keys(cases).filter(k => JSON.stringify(row[k]).includes(S))
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const c0 = process.cpuUsage()
    snap([{ id: 1, v: 'a:'.repeat(128 * 1024) }])
    const c = process.cpuUsage(c0)
    best = Math.min(best, (c.user + c.system) / 1000)
  }
  console.log(`${label}: in clear ${JSON.stringify(leaks)}; 256 KB of 'a:' cpu ${best.toFixed(0)} ms`)
}
