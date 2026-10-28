// (2) Can the PR bury a seeded collection's real destructive flag under its
// own red flags on another seeded collection, so a capped list (#36 lists
// 500 red flags) leaves it out? column-dropped is one flag per field.
import { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, divergence, flagChanges } from './repo/lib/data-diff.mjs'
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const S = collections => sanitizeSnapshot({ collections }, { masker, rules })
const WIDE = Number(process.argv[2] ?? 1600) // Postgres allows 1,600 columns a table
const extra = Array.from({ length: WIDE - 2 }, (_, i) => `c${String(i).padStart(4, '0')}`)
const accounts = (cols, n = 10) => ({ key: ['id'], fields: ['id', 'name', ...cols], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `a${i}` })), count: n })
const users = n => ({ key: ['id'], fields: ['id', 'email', 'role'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x`, role: 'member' })), count: n })
const seed = { accounts: accounts([]), users: users(50) }
const baseS = S(seed)
const base = diffSnapshots(baseS, baseS)
// boot: the PR's migration adds WIDE-2 empty columns to the seeded accounts
const S1 = S({ accounts: accounts(extra), users: users(50) })
// the click: the PR drops those columns again, and deletes 49 of 50 users
const Sn = S({ accounts: accounts([]), users: users(1) })
const pr = diffSnapshots(S1, Sn)
for (const trusted of [true, false]) {
  const flags = flagChanges(base, pr, rules, { trusted })
  const firstUsers = flags.findIndex(f => f.collection === 'users')
  const red = flags.filter(f => f.severity === 'red')
  const listed = red.slice(0, 500)
  console.log(`[trusted=${trusted}] flags ${flags.length} (red ${red.length}); first users flag at index ${firstUsers}: ${JSON.stringify(flags[firstUsers])}`)
  console.log(`  users flags: ${JSON.stringify(flags.filter(f => f.collection === 'users').map(f => f.kind))}`)
  console.log(`  first 500 red (as #36 lists them): kinds ${JSON.stringify([...new Set(listed.map(f => `${f.collection}:${f.kind}`))])}; users among them: ${listed.some(f => f.collection === 'users')}`)
}
const div = divergence(base, pr)
console.log(`divergence accounts ${div.collections.accounts.status} (${div.collections.accounts.changes.length} changes), users ${div.collections.users.status}`)
// control: without the column games, users' flags are first
const pr0 = diffSnapshots(S(seed), S({ accounts: accounts([]), users: users(1) }))
const f0 = flagChanges(base, pr0, rules, { trusted: false })
console.log(`control: ${JSON.stringify(f0.map(f => `${f.collection}:${f.kind}/${f.severity}`))}`)
