// C5 (round 3), re-run at 7193877: a collection left out past the counts
// kept (11,000 collections bigger than it) in S1, then kept in Sn because the
// PR's action drops the padding as it wipes users. Through #36's real
// capture (pull/36/head a2bbc7c's data-capture.mjs, with 7193877's
// data-diff.mjs beside it), real LIMITS. Null-safe for the folded flag.
import { createDataCapture } from './pr36lib/data-capture.mjs'
import { validateRules } from './pr36lib/data-diff.mjs'

const PAD = Number(process.argv[2] ?? 11000)
const users = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x`, role: 'member' }))
const padRows = Array.from({ length: 51 }, (_, i) => ({ id: i + 1 }))
const padding = Object.fromEntries(Array.from({ length: PAD }, (_, i) => [`aaa${String(i).padStart(5, '0')}`, { key: ['id'], rows: padRows, count: 51 }]))
const isPad = f => typeof f.collection === 'string' && f.collection.startsWith('aaa')

async function run(label, prSn) {
  const state = {
    base: { S0: { users: { key: ['id'], rows: users(50), count: 50 } }, S1: { users: { key: ['id'], rows: users(50), count: 50 } }, Sn: { users: { key: ['id'], rows: users(50), count: 50 } } },
    pr: {
      S0: { users: { key: ['id'], rows: users(50), count: 50 } },
      S1: { ...padding, users: { key: ['id'], rows: users(50), count: 50 } },
      Sn: prSn,
    },
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
    const fl = s => (s?.flags ?? []).filter(f => !isPad(f)).map(f => [f.collection, f.kind, f.severity, ...(f.collection === null ? [f.collections, f.names] : [])])
    const idx = s => (s?.flags ?? []).findIndex(f => f.collection === 'users')
    console.log(`--- ${label} [${verdict}]`)
    console.log('  problems.pr       ', JSON.stringify(v.problems?.pr).slice(0, 300))
    console.log('  boot flags        ', JSON.stringify(fl(v.boot)).slice(0, 300), 'padding flags', (v.boot?.flags ?? []).filter(isPad).length, 'listed', v.boot?.flags?.length, 'users at', idx(v.boot), 'flagsCount', JSON.stringify(v.boot?.flagsCount))
    console.log('  session flags     ', JSON.stringify(fl(v.session)).slice(0, 300), 'padding flags', (v.session?.flags ?? []).filter(isPad).length, 'listed', v.session?.flags?.length, 'users at', idx(v.session))
    const du = v.session?.divergence?.collections?.users
    console.log('  session div users ', JSON.stringify(du && { status: du.status, counts: du.counts }))
    const pu = v.session?.pr?.collections?.users
    console.log('  session PR diff users', JSON.stringify(pu && { status: pu.status, omitted: pu.omitted, countBefore: pu.countBefore, countAfter: pu.countAfter, truncated: pu.truncated }))
    console.log('  session flagsCount', JSON.stringify(v.session?.flagsCount), 'complete', JSON.stringify(v.session?.complete))
  }
  await cap.close()
}

await run(`${PAD} padding collections of 51 rows; the action drops them and wipes users`, { users: { key: ['id'], rows: [], count: 0 } })
await run(`${PAD} padding collections of 51 rows; the action drops them and updates every user`, { users: { key: ['id'], rows: users(50).map(u => ({ ...u, role: 'admin' })), count: 50 } })
await run(`${PAD} padding collections of 51 rows; the action wipes users only`, { ...padding, users: { key: ['id'], rows: [], count: 0 } })
