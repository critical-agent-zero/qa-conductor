// (1) At the real limits: 11,000 EMPTY PR tables named to sort before
// users (cheap on Postgres too). Wiping users leaves it with 0 rows, tied
// with the padding, so Sn leaves it out: the wipe reads as unverified.
import { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, divergence, flagChanges } from './repo/lib/data-diff.mjs'
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const S = collections => sanitizeSnapshot({ collections }, { masker, rules })
const users = n => ({ key: ['id'], fields: ['id', 'email'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x` })), count: n })
const PAD = Number(process.argv[2] ?? 11000)
const pad = Object.fromEntries(Array.from({ length: PAD }, (_, i) => [`t${String(i).padStart(5, '0')}`, { key: ['id'], fields: ['id'], rows: [], count: 0 }]))
const baseS = S({ users: users(50) })
const base = diffSnapshots(baseS, baseS)
const S1 = S({ ...pad, users: users(50) })
for (const [label, Sn] of [['wipe users (DELETE FROM users)', S({ ...pad, users: users(0) })], ['drop users', S({ ...pad })], ['control: wipe users, no padding', null]]) {
  const s1 = Sn ? S1 : S({ users: users(50) })
  const sn = Sn ?? S({ users: users(0) })
  const pr = diffSnapshots(s1, sn)
  const d = pr.collections.users
  for (const trusted of [true, false]) {
    const flags = flagChanges(base, pr, rules, { trusted })
    console.log(`${label} [trusted=${trusted}]: S1.omitted ${s1.omitted}, Sn.omitted ${sn.omitted}; users diff ${JSON.stringify({ status: d.status, omitted: d.omitted, countBefore: d.countBefore, countAfter: d.countAfter, deleted: d.deleted.length })}; users flags ${JSON.stringify(flags.filter(f => f.collection === 'users').map(f => `${f.kind}/${f.severity}`))} (index ${flags.findIndex(f => f.collection === 'users')} of ${flags.length}); divergence ${divergence(base, pr).collections.users.status}`)
  }
}
