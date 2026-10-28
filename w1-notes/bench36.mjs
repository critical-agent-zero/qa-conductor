// The review's #36 size case: 4 tables of 10,000 rows, rewritten at boot and
// again during the session. Prints the answer's size and the time to build it.
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'

const table = (n, tag) => ({ key: ['id'], fields: ['id', 'name', 'note'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `name ${i} ${tag}`, note: `a note about row ${i}, ${tag}` })) })
const db = tag => Object.fromEntries(['a', 'b', 'c', 'd'].map(t => [t, table(10_000, tag)]))
const stores = { base: db('s0'), pr: db('s0') }
const inspector = { open: ({ paneRef }) => ({ snapshot: () => ({ collections: structuredClone(stores[paneRef.role]) }) }) }
const capture = createDataCapture({ inspector, rules: validateRules({}) })
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
stores.base = db('s1'); stores.pr = db('s1')
await capture.ready({ signal })
stores.base = db('s2'); stores.pr = db('s2')
await capture.snapshot()
let t = performance.now()
const v = capture.view({})
const viewMs = performance.now() - t
t = performance.now()
const json = capture.viewJson({})
const jsonMs = performance.now() - t
t = performance.now()
capture.viewJson({})
const againMs = performance.now() - t
console.log(JSON.stringify({ bytes: Buffer.byteLength(json), viewMs: Math.round(viewMs), firstJsonMs: Math.round(jsonMs), againMs: +againMs.toFixed(3), updatedListed: v.session.pr.collections.a.updated.length, updatedCount: v.session.pr.collections.a.counts.updated }))
