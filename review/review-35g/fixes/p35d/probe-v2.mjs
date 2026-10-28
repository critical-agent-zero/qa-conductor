// verify-2: does a seeded collection's destructive flag get buried by
// per-stub red 'unverified' flags in #36's bounded view?
// Variants:
//  A: probe-c5 exact (11,000 padding of 51 rows, users left out): do problems name users?
//  B: users kept WHOLE (padding 11,000 EMPTY tables): cheapest padding, users' real delete flags
//  C: users as a STUB (10,999 padding of 51 rows)
import { createDataCapture } from './pr36lib/data-capture.mjs'
import { validateRules, sanitizeSnapshot, createMasker, diffSnapshots, flagChanges } from './repo/lib/data-diff.mjs'

const users = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x`, role: 'member' }))
const U = n => ({ key: ['id'], rows: users(n), count: n })
const padding = (n, rows, prefix = 'aaa') => {
  const padRows = Array.from({ length: rows }, (_, i) => ({ id: i + 1 }))
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${String(i).padStart(5, '0')}`, { key: ['id'], rows: padRows, count: rows }]))
}

async function run(label, pad, left = 0) {
  const state = {
    base: { S0: { users: U(50) }, S1: { users: U(50) }, Sn: { users: U(50) } },
    pr: { S0: { users: U(50) }, S1: { ...pad, users: U(50) }, Sn: { ...pad, users: U(left) } },
  }
  let phase = 'S0'
  const inspector = { open: async ({ paneRef }) => ({ snapshot: async () => ({ collections: state[paneRef.role][phase] }) }) }
  const cap = createDataCapture({ inspector, rules: validateRules({}) })
  await cap.seeded({ paneRef: { role: 'base' } })
  await cap.seeded({ paneRef: { role: 'pr' } })
  phase = 'S1'
  await cap.ready({})
  phase = 'Sn'
  await cap.snapshot()
  for (const verdict of ['isolated', 'reachable']) {
    const v = cap.view({ isolation: { verdict } })
    const json = JSON.stringify(v)
    const s = v.session
    console.log(`--- ${label} [${verdict}]`)
    console.log('  problems.pr:', JSON.stringify(v.problems.pr))
    console.log('  session flags listed', s.flags.length, 'flagsCount', JSON.stringify(s.flagsCount), 'users flags listed', JSON.stringify(s.flags.filter(f => f.collection === 'users').map(f => [f.kind, f.severity])))
    console.log('  session kinds listed', JSON.stringify([...new Set(s.flags.map(f => f.kind))]))
    console.log('  session pr diff lists users?', Object.hasOwn(s.pr.collections, 'users'), 'collectionsCount', s.pr.collectionsCount, '| divergence lists users?', Object.hasOwn(s.divergence.collections, 'users'))
    console.log('  "users" appears anywhere in view JSON?', json.includes('"users"'), '| word users in JSON?', /users/.test(json))
  }
  await cap.close()
}

await run('A: c5 exact, 11000 pad x 51 rows, wipe users', padding(11000, 51))
await run('B: 11000 EMPTY pad tables, users kept whole, wipe users', padding(11000, 0))
await run('C: 10999 pad x 51 rows, users a stub, wipe users', padding(10999, 51))
// control: padding named after users sorts after: users visible
await run('D: control, 11000 EMPTY pad named zzz', padding(11000, 0, 'zzz'))
// the reply's variant E: 11,000 empty aaa* tables, the click deletes 49 of 50 users
await run('E: 11000 EMPTY pad tables, delete 49 of 50 users', padding(11000, 0), 1)
console.log('folded flags in E-like engine run below')

// engine: index of users flags in B
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const S = c => sanitizeSnapshot({ collections: c }, { masker, rules })
const pad = padding(11000, 0)
const base = diffSnapshots(S({ users: U(50) }), S({ users: U(50) }))
const pr = diffSnapshots(S({ ...pad, users: U(50) }), S({ ...pad, users: U(0) }))
const flags = flagChanges(base, pr, rules, { trusted: true })
const ui = flags.map((f, i) => [i, f]).filter(([, f]) => f.collection === 'users').map(([i, f]) => [i, f.kind, f.severity, f.pr])
console.log('engine B: flags', flags.length, 'users flags at', JSON.stringify(ui), 'folded flag', JSON.stringify(flags.find(f => f.collection === null)))
console.log('engine B: PR diff users', JSON.stringify({ status: pr.collections.users.status, deleted: pr.collections.users.deleted.length, truncated: pr.collections.users.truncated }))
