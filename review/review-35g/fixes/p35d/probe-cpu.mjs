// (5) One PR-pane snapshot at the 32 MB limit, made of 256 KB text cells of
// one adversarial shape: how long sanitizeSnapshot holds the event loop.
// usage: node probe-cpu.mjs <engine: head|old> <shape> [cells=128]
const engine = process.argv[2] ?? 'head'
const shape = process.argv[3] ?? 'url'
const CELLS = Number(process.argv[4] ?? 128)
const lib = engine === 'old' ? './old/data-diff-2ec0bba.mjs' : './repo/lib/data-diff.mjs'
const { createMasker, sanitizeSnapshot, validateRules } = await import(lib)

const N = 256 * 1024
const fill = unit => unit.repeat(Math.ceil(N / unit.length)).slice(0, N)
const units = {
  plain: 'lorem ipsum dolor sit amet ',
  url: 'a://:x@', // an empty user: new at head
  urlu: 'a://u:x@', // a user of one character: matched at 2ec0bba too
  auth: 'token 1234567a ',
  authB: 'Bearer 12345678 ',
  tag: '<a ', // attribute scan: new at head
  tagns: '<a:a ',
  keys: 'a=',
  nd: '[\n', // NDJSON-looking lines that each fail JSON.parse
}
const cellText = fill(units[shape])
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
// one collection, CELLS rows, one 256 KB text cell each, under a neutral name
const rows = Array.from({ length: CELLS }, (_, i) => ({ id: i, note: cellText }))
const raw = { collections: { notes: { key: ['id'], rows, count: CELLS } } }
const rawMB = (CELLS * N) / 1048576
let ticks = 0
const timer = setInterval(() => ticks++, 5)
const t = performance.now()
const snap = sanitizeSnapshot(raw, { masker, rules })
const took = performance.now() - t
clearInterval(timer)
const c = snap.collections.notes
console.log(`${engine} ${shape}: ${CELLS} cells x 256 KB = ${rawMB} MB raw; sanitizeSnapshot ${took.toFixed(0)} ms (${(took / CELLS).toFixed(1)} ms a cell); 5 ms timer ticks during it: ${ticks}; kept rows ${c.rows.length}, truncated ${c.truncated}; sample cell ${JSON.stringify(c.rows[0].note).slice(0, 120)}`)
