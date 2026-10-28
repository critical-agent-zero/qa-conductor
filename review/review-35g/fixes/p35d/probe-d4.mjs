// D4: the new order is red, then the base pane's collections, then
// destructive kinds, then by collection and kind. column-dropped is the one
// red kind raised per field, and the PR controls its own pane's schema. Its
// migration adds P columns to a base-pane collection (accounts, which sorts
// before users; or users itself), and the reviewer's click drops them while
// it wipes users, or mass-updates it. Where do users' flags land, at the
// engine and in #36's 500-flag list?
import * as E from './repo/lib/data-diff.mjs'
import { createDataCapture } from './pr36lib/data-capture.mjs'

const P = Number(process.argv[2] ?? 1600)
const pad = Array.from({ length: P }, (_, i) => `zz_pad_${String(i).padStart(4, '0')}`)
const people = (n, role = 'member') => Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x`, role }))
const accts = [1, 2, 3, 4, 5].map(id => ({ id, name: `a${id}` }))
const col = (rows, fields) => ({ key: ['id'], fields, rows, count: rows.length })
const baseState = { accounts: col(accts, ['id', 'name']), users: col(people(50), ['id', 'email', 'role']) }
const variants = {
  'pad accounts, wipe users': {
    S1: { accounts: col(accts, ['id', 'name', ...pad]), users: col(people(50), ['id', 'email', 'role']) },
    Sn: { accounts: col(accts, ['id', 'name']), users: col([], ['id', 'email', 'role']) },
  },
  'pad users itself, mass-update users': {
    S1: { accounts: col(accts, ['id', 'name']), users: col(people(50), ['id', 'email', 'role', ...pad]) },
    Sn: { accounts: col(accts, ['id', 'name']), users: col(people(50, 'admin'), ['id', 'email', 'role']) },
  },
  'control: no padding, wipe users': {
    S1: baseState,
    Sn: { accounts: col(accts, ['id', 'name']), users: col([], ['id', 'email', 'role']) },
  },
}
const rules = E.validateRules({})
for (const [label, v] of Object.entries(variants)) {
  const masker = E.createMasker({ key: Buffer.alloc(32, 7), rules })
  const S = c => E.sanitizeSnapshot({ collections: c }, { masker, rules })
  const b = S(baseState)
  const flags = E.flagChanges(E.diffSnapshots(b, b), E.diffSnapshots(S(v.S1), S(v.Sn)), rules, { trusted: true })
  const users = flags.map((f, i) => [i, f]).filter(([, f]) => f.collection === 'users' && f.kind !== 'column-dropped').map(([i, f]) => `${f.kind}/${f.severity}@${i}`)
  console.log(`engine  ${label.padEnd(36)} ${flags.length} flags (${flags.filter(f => f.severity === 'red').length} red); users' non-column flags ${JSON.stringify(users)}; first ${JSON.stringify([flags[0].collection, flags[0].kind, flags[0].field])}`)

  // through #36's capture
  const state = { base: { S0: baseState, S1: baseState, Sn: baseState }, pr: { S0: baseState, S1: v.S1, Sn: v.Sn } }
  let phase = 'S0'
  const inspector = { open: async ({ paneRef }) => ({ snapshot: async () => ({ collections: state[paneRef.role][phase] }) }) }
  const cap = createDataCapture({ inspector, rules })
  await cap.seeded({ paneRef: { role: 'base' } })
  await cap.seeded({ paneRef: { role: 'pr' } })
  phase = 'S1'
  await cap.ready({})
  phase = 'Sn'
  await cap.snapshot()
  const view = cap.view({ isolation: { verdict: 'isolated' } })
  const listed = view.session?.flags ?? []
  const lu = listed.filter(f => f.collection === 'users' && f.kind !== 'column-dropped').map(f => `${f.kind}/${f.severity}`)
  console.log(`#36 view ${label.padEnd(35)} listed ${listed.length}, flagsCount ${JSON.stringify(view.session?.flagsCount)}; users' non-column flags listed ${JSON.stringify(lu)}; kinds listed ${JSON.stringify([...new Set(listed.map(f => `${f.collection}:${f.kind}`))])}`)
  await cap.close()
}
