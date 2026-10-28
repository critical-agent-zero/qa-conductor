// (1) The omitted-collections handling, as untrusted PR data.
import { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, divergence, flagChanges } from './repo/lib/data-diff.mjs'
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const S = (collections, limits) => sanitizeSnapshot({ collections }, { masker, rules, limits })
const users = n => ({ key: ['id'], fields: ['id', 'email', 'role'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x`, role: 'member' })), count: n })
const orders = n => ({ key: ['id'], fields: ['id', 'total'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, total: i })), count: n })
const LONG = 'x'.repeat(201) // one PR collection with a 201-character name (Mongo, SQLite, DynamoDB allow it)
const pick = (flags, name) => flags.filter(f => f.collection === name).map(f => `${f.kind}/${f.severity}${f.shared ? '/shared' : ''}`)
const show = (label, s1, sn, base, name = 'users') => {
  const pr = diffSnapshots(s1, sn)
  const d = pr.collections[name]
  for (const trusted of [true, false]) {
    const flags = flagChanges(base, pr, rules, { trusted })
    console.log(`${label} [trusted=${trusted}]\n  S1.omitted=${s1.omitted} Sn.omitted=${sn.omitted}; PR diff ${name}: ${d ? JSON.stringify({ status: d.status, omitted: d.omitted, countBefore: d.countBefore, countAfter: d.countAfter, deleted: d.deleted.length }) : 'absent'}\n  ${name} flags ${JSON.stringify(pick(flags, name))}; all flags ${JSON.stringify(flags.map(f => `${f.collection === null ? '(summary)' : f.collection.slice(0, 12)}:${f.kind}/${f.severity}`))}; divergence ${name} ${divergence(base, pr).collections[name]?.status}`)
  }
}
const seed = { users: users(50), orders: orders(20) }
const baseS = S(seed)
const base = diffSnapshots(baseS, baseS) // the base pane: the same action changes nothing

console.log('=== A1 control: the click drops users (no long name anywhere)')
show('A1', S(seed), S({ orders: orders(20) }), base)
console.log('=== A2 the same drop, with one PR collection named 201 characters in Sn only')
show('A2', S(seed), S({ orders: orders(20), [LONG]: { key: null, rows: [] } }), base)
console.log('=== A3 the same drop, with the 201-character collection made at boot (in S1 and Sn)')
show('A3', S({ ...seed, [LONG]: { key: null, rows: [] } }), S({ orders: orders(20), [LONG]: { key: null, rows: [] } }), base)
console.log('=== A4 the drop of orders and users together, long name in both: what the reviewer sees for each')
show('A4 users', S({ ...seed, [LONG]: { key: null, rows: [] } }), S({ [LONG]: { key: null, rows: [] } }), base)
show('A4 orders', S({ ...seed, [LONG]: { key: null, rows: [] } }), S({ [LONG]: { key: null, rows: [] } }), base, 'orders')
console.log('=== A5 users left out on BOTH sides (maxCollections 2, 25 padding of more rows), click wipes users')
const pad = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`aaa${i}`, { key: ['id'], rows: Array.from({ length: 60 }, (_, j) => ({ id: j })), count: 60 }]))
const lim = { maxCollections: 2 }
show('A5', S({ ...seed, ...pad }, lim), S({ ...pad, users: users(0), orders: orders(20) }, lim), base)
console.log('=== A6 users kept in S1, left out in Sn (padding added by the click), and wiped')
show('A6', S({ ...seed }, lim), S({ ...pad, users: users(0), orders: orders(20) }, lim), base)
