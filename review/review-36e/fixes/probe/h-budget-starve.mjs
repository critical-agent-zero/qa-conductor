// Round 2: the answer's ~4 MB row budget is shared first-come across the
// whole answer (boot before session). The PR's migration inserts 50 wide
// rows into a table of its own; the reviewer's session then deletes saved
// carts in both panes. What do the session lists show?
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const carts = ids => ({ key: ['id'], fields: ['id', 'owner'], rows: ids.map(id => ({ id, owner: `u${id}` })) })
const wide = i => { const r = { id: i }; for (let f = 0; f < 400; f++) r[`f${f}`] = `${i}-${f}-`.padEnd(200, 'p'); return r }
const stores = { base: { saved_carts: carts([1, 2, 3]) }, pr: { saved_carts: carts([1, 2, 3]) } }
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => ({ collections: structuredClone(stores[paneRef.role]) }) }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
// 49 wide rows, then one sized so the budget has 5 characters left: a PR's
// rows are its own, and their JSON is deterministic
const sorted = r => Object.fromEntries(Object.keys(r).sort().map(k => [k, r[k]]))
const itemSize = (i, r) => JSON.stringify({ key: `[${i}]`, row: sorted(r) }).length
const rowsPad = Array.from({ length: 49 }, (_, i) => wide(i))
let left = 4 * 1024 * 1024 - rowsPad.reduce((n, r, i) => n + itemSize(i, r), 0) - 5
const last = { id: 49 }
for (let f = 0; itemSize(49, last) < left; f++) {
  last[`g${String(f).padStart(4, '0')}`] = ''
  const room = left - itemSize(49, last)
  last[`g${String(f).padStart(4, '0')}`] = 'q'.repeat(Math.max(0, Math.min(200, room)))
}
console.log('last row item size', itemSize(49, last), 'target', left)
stores.pr.audit_log = { key: ['id'], fields: ['id'], rows: [...rowsPad, last] }
await capture.ready({ signal })
stores.base.saved_carts = carts([])
stores.pr.saved_carts = carts([])
await capture.snapshot()
const v = JSON.parse(capture.viewJson({ isolation: { verdict: 'isolated' } }))
const sc = s => s.collections.saved_carts
console.log('answer', (capture.viewJson({ isolation: { verdict: 'isolated' } }).length / 1e6).toFixed(2), 'MB; boot.pr audit_log inserted listed', v.boot.pr.collections.audit_log.inserted.length, 'of', v.boot.pr.collections.audit_log.counts.inserted)
console.log('session.base saved_carts deleted listed', sc(v.session.base).deleted.length, 'of', sc(v.session.base).counts.deleted, '| session.pr', sc(v.session.pr).deleted.length, 'of', sc(v.session.pr).counts.deleted)
console.log('session divergence changes listed', v.session.divergence.collections.saved_carts.changes.length, 'of', v.session.divergence.collections.saved_carts.changesCount)
console.log('cut marker: boot.pr.audit_log.cut =', v.boot.pr.collections.audit_log.cut, '| session.pr saved_carts.cut =', sc(v.session.pr).cut)
// the PR's boot span: what else did its wide rows starve in the same span?
console.log('boot.divergence audit_log changes listed', v.boot.divergence.collections.audit_log.changes.length, 'of', v.boot.divergence.collections.audit_log.changesCount, 'cut', v.boot.divergence.collections.audit_log.cut)
console.log('session.flags', JSON.stringify(v.session.flags.map(f => `${f.collection}:${f.kind}:${f.severity}`)))
