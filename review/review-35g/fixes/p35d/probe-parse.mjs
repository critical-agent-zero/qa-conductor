// (5) Strings that look like JSON but aren't: each costs a thrown
// JSON.parse (about 8 us of CPU). How many can one cell or snapshot hold?
// usage: node probe-parse.mjs <engine head|old> <MB>
const engine = process.argv[2] ?? 'head'
const MB = Number(process.argv[3] ?? 2)
const lib = engine === 'old' ? './old/data-diff-2ec0bba.mjs' : './repo/lib/data-diff.mjs'
const { createMasker, sanitizeSnapshot, validateRules } = await import(lib)
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const K = 256 * 1024
const BYTES = MB * 1048576
const fill = (unit, n = K) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n)
const shapes = {
  'text cell "[\\n" x 128K lines (NDJSON path)': () => Array.from({ length: Math.round(BYTES / K) }, (_, i) => ({ id: i, note: fill('[\n') })),
  'text cell "[x]\\n" lines': () => Array.from({ length: Math.round(BYTES / K) }, (_, i) => ({ id: i, note: fill('[x]\n') })),
  'text cell "{}\\n[\\n" (one line parses)': () => Array.from({ length: Math.round(BYTES / K) }, (_, i) => ({ id: i, note: '{}\n' + fill('[\n') })),
  'JSON value ["[","[",...]': () => { const per = 50_000; return Array.from({ length: Math.round(BYTES / (per * 4)) }, (_, i) => ({ id: i, doc: Array(per).fill('[') })) },
  'JSON value ["[x]",...]': () => { const per = 50_000; return Array.from({ length: Math.round(BYTES / (per * 6)) }, (_, i) => ({ id: i, doc: Array(per).fill('[x]') })) },
  'row fields each "[" (one cell each)': () => { const per = 1000; return Array.from({ length: Math.round(BYTES / (per * 10)) }, (_, i) => { const r = { id: i }; for (let j = 0; j < per; j++) r[`f${j}`] = '['; return r }) },
}
for (const [name, build] of Object.entries(shapes)) {
  const rows = build()
  const rawBytes = JSON.stringify(rows).length
  global.gc?.()
  const c0 = process.cpuUsage()
  const t = performance.now()
  const snap = sanitizeSnapshot({ collections: { t: { key: ['id'], rows, count: rows.length } } }, { masker, rules })
  const took = performance.now() - t
  const c = process.cpuUsage(c0)
  const cpu = (c.user + c.system) / 1000
  const perCell = name.startsWith('text') ? ` (${(cpu / rows.length).toFixed(0)} ms cpu a 256 KB cell)` : ''
  console.log(`${engine} ${name.padEnd(44)} raw ${(rawBytes / 1048576).toFixed(1)} MB: cpu ${cpu.toFixed(0)} ms, wall ${took.toFixed(0)} ms -> ${(cpu / (rawBytes / 1048576) * 32 / 1000).toFixed(1)} s cpu at 32 MB${perCell}; kept ${snap.collections.t.rows.length}/${rows.length}`)
}
