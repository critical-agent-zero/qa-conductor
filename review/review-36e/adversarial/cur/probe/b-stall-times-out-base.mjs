// Round 5, lens: hiding through timing. W28=B accepts that PR data can hold
// the event loop, and judgment call E and the README say a stall "hides or
// excuses no destructive change". But take() runs sanitizeSnapshot inline
// once the PR's read resolves, while the base pane's read, run beside it, is
// still waiting on I/O. The base's timeout timer is a timer: once the stall
// ends, Node's timers phase runs before the poll phase that would deliver
// the base's I/O, so the base's read fails as "timed out" although its data
// had come. The session span then has no base diff (a-base-null.mjs), and
// the PR's own dropped tables bury a seeded delete.
//
// Usage: node b-stall-times-out-base.mjs TIMEOUT_MS STALL_CELLS N
//   TIMEOUT_MS: limits.timeoutMs (30000 is the default); STALL_CELLS: how
//   many 256 KB text cells of "[\n" lines (JSON-looking, not JSON) the PR's
//   app writes in the session; N: the PR's own tables, dropped in the session
import { execFile } from 'node:child_process'
import { createDataCapture } from '../lib/data-capture.mjs'
import { validateRules } from '../lib/data-diff.mjs'

const rules = validateRules({})
const TIMEOUT = Number(process.argv[2] ?? 2000)
const CELLS = Number(process.argv[3] ?? 0)
const N = Number(process.argv[4] ?? 1000)
const K = 256 * 1024
const cell = '[\n'.repeat(K / 2)
const users = n => ({ key: ['id'], fields: ['id', 'name'], rows: Array.from({ length: n }, (_, i) => ({ id: i, name: `user${i}` })) })
const own = Object.fromEntries(Array.from({ length: N }, (_, t) => [`a${String(t).padStart(5, '0')}`, { key: ['id'], fields: ['id'], rows: [{ id: 0 }, { id: 1 }] }]))
const notes = { key: ['id'], fields: ['id', 'note'], rows: Array.from({ length: CELLS }, (_, i) => ({ id: i, note: cell })) }
// a read that waits on real I/O (a child process), as a database read would
const io = ms => new Promise((resolve, reject) => execFile('/bin/sh', ['-c', `sleep ${ms / 1000}`], err => (err ? reject(err) : resolve())))
let phase = 'seed'
const capture = createDataCapture({
  rules,
  limits: { timeoutMs: TIMEOUT },
  inspector: { open: ({ paneRef }) => ({ snapshot: async () => {
    if (paneRef.role === 'base') {
      await io(400)
      return { collections: { users: users(20) } }
    }
    if (phase === 'seed') return { collections: { users: users(20) } }
    if (phase === 'ready') return { collections: { users: users(20), ...own } }
    // session: the PR's app deletes 15 of 20 seeded users, drops its own
    // tables, and writes notes that are slow to mask; its read is quick
    await io(50)
    return { collections: { users: users(5), notes } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
phase = 'now'
let gap = 0; let last = performance.now(); const tick = setInterval(() => { const n = performance.now(); gap = Math.max(gap, n - last); last = n }, 50)
const t0 = performance.now()
await capture.snapshot()
const took = performance.now() - t0; clearInterval(tick); console.log(`longest event-loop hold during the snapshot: ${(gap / 1000).toFixed(1)} s`)
const v = JSON.parse(capture.viewJson({ isolation: { verdict: 'isolated' } }))
const s = v.session
const usersFlags = s.flags.filter(f => f.collection === 'users').map(f => `${f.kind}:${f.severity}`)
console.log(`timeoutMs=${TIMEOUT} stall cells=${CELLS} (${(CELLS * K / 1048576).toFixed(1)} MB) N=${N}: Snapshot now took ${(took / 1000).toFixed(1)} s; errors.session=${JSON.stringify(v.errors.session)}`)
console.log(`  session: complete=${s.complete} flagsCount=${JSON.stringify(s.flagsCount)} listed=${s.flags.length}; first: ${JSON.stringify(s.flags.slice(0, 2).map(f => `${f.collection}:${f.kind}`))}; users flags listed: ${JSON.stringify(usersFlags)}`)
for (const part of ['pr', 'divergence', 'base']) {
  const d = s[part]
  if (d === null) { console.log(`  session.${part}: null`); continue }
  const names = Object.keys(d.collections)
  console.log(`  session.${part}: listed ${names.length} of ${d.collectionsCount}, cut=${d.cut ?? false}; users listed? ${names.includes('users')}`)
}
const found = usersFlags.length > 0 || ['pr', 'divergence', 'base'].some(p => s[p] && Object.hasOwn(s[p].collections, 'users'))
console.log(`  => users' delete findable in the answer: ${found}`)
