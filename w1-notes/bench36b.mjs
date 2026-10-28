// The worst answers #36 round 2 can build: many collections, all changed,
// wide rows, many fields; and the review's 100 x 1,600 columns.
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'

async function run(label, s0, s1, sn) {
  let state = s0
  const capture = createDataCapture({ inspector: { open: () => ({ snapshot: () => ({ collections: structuredClone(state) }) }) }, rules: validateRules({}) })
  const signal = new AbortController().signal
  for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
  state = s1
  await capture.ready({ signal })
  state = sn
  await capture.snapshot()
  const t = performance.now()
  const json = capture.viewJson({})
  console.log(label, JSON.stringify({ mb: +(json.length / 1048576).toFixed(2), ms: Math.round(performance.now() - t) }))
}

const wide = (n, tag) => Array.from({ length: n }, (_, i) => ({ id: i, a: `${tag}${'x'.repeat(150)}`, b: `${tag}${'y'.repeat(150)}` }))
const many = (count, rows, tag, fields = []) => Object.fromEntries(Array.from({ length: count }, (_, c) => [`collection_with_a_long_name_${String(c).padStart(5, '0')}`, { key: ['id'], fields: ['id', 'a', 'b', ...fields], rows: wide(rows, tag) }]))
const cols = Array.from({ length: 1_600 }, (_, i) => `column_with_a_rather_long_name_${String(i).padStart(4, '0')}`)
await run('1000 collections x 20 rows rewritten', many(1_000, 20, 'p'), many(1_000, 20, 'q'), many(1_000, 20, 'r'))
await run('100 tables x 1600 columns', many(100, 1, 'p'), many(100, 1, 'p', cols), many(100, 1, 'p'))
await run('3000 collections (2000 as counts) changed', many(3_000, 2, 'p'), many(3_000, 3, 'q'), many(3_000, 1, 'r'))
