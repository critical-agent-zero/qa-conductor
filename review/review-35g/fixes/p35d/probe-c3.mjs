// C3: the masker's cache is capped at 50,000 fields by count, not by bytes.
// Long fresh field names in one collection, a few per snapshot: does the
// retained heap grow with each discarded snapshot?
import { createMasker, sanitizeSnapshot, validateRules } from './repo/lib/data-diff.mjs'
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const mb = n => (n / 1048576).toFixed(1) + ' MB'
const heap = () => { global.gc(); return process.memoryUsage().heapUsed }
const NAME = Number(process.argv[2] ?? 16384)
const PER = Number(process.argv[3] ?? 1000)
const ROUNDS = Number(process.argv[4] ?? 10)
const h0 = heap()
for (let round = 0; round < ROUNDS; round++) {
  const row = { id: 1 }
  for (let f = 0; f < PER; f++) row[`r${round}_f${f}_`.padEnd(NAME, 'x')] = 1
  const out = sanitizeSnapshot({ collections: { docs: { key: ['id'], rows: [row] } } }, { masker, rules })
  console.log(`after snapshot ${round + 1} (${mb(NAME * PER)} of names in its input): fields cached ${masker.cachedFields()}, rows kept ${out.collections.docs.rows.length}, problems ${JSON.stringify(out.problems).slice(0, 80)}, retained heap ${mb(heap() - h0)}`)
}
