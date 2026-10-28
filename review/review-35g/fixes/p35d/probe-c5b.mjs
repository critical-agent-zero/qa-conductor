// C5b (round 3), re-run at 7193877 at the engine level: what flagChanges and
// divergence say about users, without #36's 500-flag view cap.
import { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, divergence, flagChanges } from './repo/lib/data-diff.mjs'
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const PAD = Number(process.argv[2] ?? 11000)
const users = (n, role = 'member') => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x`, role })), count: n })
const padRows = Array.from({ length: 51 }, (_, i) => ({ id: i + 1 }))
const padding = Object.fromEntries(Array.from({ length: PAD }, (_, i) => [`aaa${String(i).padStart(5, '0')}`, { key: ['id'], rows: padRows, count: 51 }]))
const S = collections => sanitizeSnapshot({ collections }, { masker, rules })
const baseS = S({ users: users(50) })
const base = diffSnapshots(baseS, baseS)
const S0 = S({ users: users(50) })
const S1 = S({ ...padding, users: users(50) })
console.log('S1 problems', JSON.stringify(S1.problems).slice(0, 300), 'omitted', S1.omitted)
for (const [label, Sn] of [
  ['action drops the padding and wipes users', S({ users: users(0) })],
  ['action drops the padding and updates every user', S({ users: users(50, 'admin') })],
  ['action drops the padding and adds 2 users, updating all', S({ users: users(52, 'admin') })],
  ['action wipes users, padding stays', S({ ...padding, users: users(0) })],
]) {
  const pr = diffSnapshots(S1, Sn)
  const boot = diffSnapshots(S0, S1)
  for (const trusted of [true, false]) {
    const flags = flagChanges(base, pr, rules, { trusted })
    const bootFlags = flagChanges(base, boot, rules, { trusted })
    const u = f => f.filter(x => x.collection === 'users').map(x => [x.kind, x.severity, x.shared])
    const at = f => f.findIndex(x => x.collection === 'users')
    const pu = pr.collections.users
    console.log(`--- ${label} [trusted=${trusted}]`)
    console.log(`  session: users flags ${JSON.stringify(u(flags))} (index ${at(flags)} of ${flags.length}); PR diff users ${JSON.stringify(pu && { status: pu.status, omitted: pu.omitted, inserted: pu.inserted.length, countBefore: pu.countBefore, countAfter: pu.countAfter })}; divergence users ${JSON.stringify(divergence(base, pr).collections.users && { status: divergence(base, pr).collections.users.status, counts: divergence(base, pr).collections.users.counts })}`)
    console.log(`  first 3 session flags ${JSON.stringify(flags.slice(0, 3).map(f => [f.collection, f.kind, f.severity, f.collections ?? '']))}`)
    console.log(`  boot:    users flags ${JSON.stringify(u(bootFlags))} (index ${at(bootFlags)} of ${bootFlags.length}); boot diff users ${JSON.stringify(boot.collections.users && { status: boot.collections.users.status })}; folded ${JSON.stringify(bootFlags.filter(f => f.collection === null).map(f => [f.collections, f.names]))}`)
  }
}
