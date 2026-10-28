// Own probe for the claim: within tier 0 each list is listed whole before the next.
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'

const ref = role => ({ role, slug: `qa-7-${role}`, publicOrigin: `http://127.0.0.1:${role === 'base' ? 1 : 2}` })
const rules = validateRules({ classify: [] })
async function setup(snapshot, capOpts = {}) {
  const capture = createDataCapture({
    inspector: { async open({ paneRef }) { return { async snapshot() { return { collections: structuredClone(snapshot(paneRef.role)) } }, async close() {} } } },
    rules, ...capOpts,
  })
  const signal = new AbortController().signal
  for (const role of ['base', 'pr']) await capture.seeded({ paneRef: ref(role), db: {}, databases: ['shop'], signal })
  return { capture, signal }
}
const users = n => ({ key: ['id'], fields: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
const summary = (label, span) => {
  const out = { label, flagsCount: span.flagsCount, flags: span.flags.length, firstFlag: span.flags[0] && [span.flags[0].collection, span.flags[0].kind, span.flags[0].severity] }
  for (const l of ['pr', 'divergence', 'base']) {
    const x = span[l]
    if (!x) { out[l] = null; continue }
    const names = Object.keys(x.collections)
    out[l] = { listed: names.length, of: x.collectionsCount, cut: !!x.cut, users: Object.hasOwn(x.collections, 'users') ? (x.collections.users.status + (x.collections.users.deleted ? ` del=${x.collections.users.counts.deleted} listedDel=${x.collections.users.deleted.length}` : '')) : 'ABSENT', first: names.slice(0, 2) }
  }
  console.log(JSON.stringify(out))
}

// Shape A: s2-wide-rows. PR makes T tables of 50 wide rows at boot, empties
// them in the session, and deletes 15 of 20 users.
async function wide(T, cols) {
  const width = 200
  const base = { users: users(20) }
  const names = Array.from({ length: cols }, (_, c) => `c${c}`)
  const tab = n => ({ key: ['id'], fields: ['id', ...names], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, ...Object.fromEntries(names.map(c => [c, `${c}:${i}:` + 'w'.repeat(width - 10)])) })) })
  const own = n => Object.fromEntries(Array.from({ length: T }, (_, t) => [`t${String(t).padStart(3, '0')}`, tab(n)]))
  let pr = base
  const { capture, signal } = await setup(role => role === 'base' ? base : pr)
  pr = { ...base, ...own(50) }
  await capture.ready({ signal })
  pr = { ...own(0), users: users(5) }
  await capture.snapshot()
  const v = capture.view({})
  summary(`wide T=${T} cols=${cols} session`, v.session)
  summary(`wide T=${T} cols=${cols} boot`, v.boot)
  console.log('  view bytes', Buffer.byteLength(capture.viewJson({})))
}

// Shape B: round 4's 'both N 6': N seeded tables with 6 renamed columns and
// a rewritten text column, beside a users delete of 15 of 20.
async function both(N, rowsN, width) {
  const rows = (text) => Array.from({ length: rowsN }, (_, i) => ({ id: i + 1, text }))
  const tables = (prefix, text) => Object.fromEntries(Array.from({ length: N }, (_, t) => [`a${String(t).padStart(3, '0')}`, { key: ['id'], fields: ['id', 'text', ...Array.from({ length: 6 }, (_, i) => `${prefix}${i}`)], rows: rows(text) }]))
  const base = { ...tables('old_', 'x'.repeat(width)), users: users(20) }
  let pr = base
  const { capture, signal } = await setup(role => role === 'base' ? base : pr)
  pr = { ...tables('new_', 'y'.repeat(width)), users: users(5) }
  await capture.ready({ signal })
  summary(`both N=${N} rows=${rowsN} width=${width} boot`, capture.view({}).boot)
}

const [shape, ...args] = process.argv.slice(2)
if (shape === 'wide') await wide(+args[0], +args[1])
if (shape === 'both') await both(+args[0], +args[1], +args[2])
