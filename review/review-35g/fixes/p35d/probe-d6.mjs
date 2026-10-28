// D6: one PR-made collection whose name is over 200 characters makes its
// snapshot's `omitted` 1. Every collection missing from that snapshot is
// then `unknown`, though a short name can't be the long one left out. Does
// the PR's drop of users still read as dropped?
import * as E from './repo/lib/data-diff.mjs'
const rules = E.validateRules({})
const masker = E.createMasker({ key: Buffer.alloc(32, 7), rules })
const S = c => E.sanitizeSnapshot({ collections: c }, { masker, rules })
const people = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })), count: n })
const long = 'x'.repeat(201)
const orders = { key: ['id'], rows: [1, 2, 3].map(id => ({ id })), count: 3 }
const base = S({ users: people(50), orders })
const baseDiff = E.diffSnapshots(base, base)
for (const [label, s1, sn] of [
  ['drop users (control)', { users: people(50), orders }, { orders }],
  ['drop users, one 201-char collection in Sn', { users: people(50), orders }, { orders, [long]: people(1) }],
  ['drop users and empty orders, 201-char collection in Sn', { users: people(50), orders }, { orders: people(0), [long]: people(1) }],
]) {
  const a = S(s1)
  const b = S(sn)
  const pr = E.diffSnapshots(a, b)
  const flags = E.flagChanges(baseDiff, pr, rules, { trusted: true })
  console.log(`${label.padEnd(56)} Sn.omitted ${b.omitted}; users ${JSON.stringify({ status: pr.collections.users.status, omitted: pr.collections.users.omitted })}; flags ${JSON.stringify(flags.map(f => [f.collection, f.kind, f.severity]))}; divergence ${E.divergence(baseDiff, pr).collections.users.status}`)
}
