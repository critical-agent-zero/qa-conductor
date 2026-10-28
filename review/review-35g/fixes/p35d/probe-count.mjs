// How many HMACs and thrown JSON.parse calls one cell costs, per shape.
import crypto from 'node:crypto'
let hmacs = 0
let throws = 0
let parses = 0
const realParse = JSON.parse
JSON.parse = function (...a) { parses++; try { return realParse.apply(this, a) } catch (e) { throws++; throw e } }
const realHmac = crypto.createHmac
// data-diff imports createHmac by name from node:crypto, so count through a loader-free wrapper:
// patching the module namespace is not possible, so time-and-count with a copy instead.
const src = (await import('node:fs')).readFileSync(new URL('./repo/lib/data-diff.mjs', import.meta.url), 'utf8')
  .replace("import { createHmac } from 'node:crypto'", 'const createHmac = (...a) => { globalThis.__hmacs++; return globalThis.__realHmac(...a) }')
globalThis.__hmacs = 0
globalThis.__realHmac = realHmac
const { writeFileSync } = await import('node:fs')
writeFileSync(new URL('./exp/data-diff-counted.mjs', import.meta.url), src)
const { createMasker, sanitizeSnapshot, validateRules } = await import('./exp/data-diff-counted.mjs')
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const shapes = {
  'list ["pass","x"] x 1000': { doc: Array.from({ length: 2000 }, (_, j) => (j % 2 ? 'x' : 'pass')) },
  'pairs {k:"pass",v:1} x 1000': { doc: Array.from({ length: 1000 }, () => ({ k: 'pass', v: 1 })) },
  'text "a://:x@" x 1000': { note: 'a://:x@'.repeat(1000) },
  'text "[\\n" x 1000': { note: '[\n'.repeat(1000) },
  'JSON ["[" x 1000]': { doc: Array(1000).fill('[') },
}
for (const [name, row] of Object.entries(shapes)) {
  globalThis.__hmacs = 0; throws = 0; parses = 0
  sanitizeSnapshot({ collections: { t: { key: null, rows: [row], count: 1 } } }, { masker, rules })
  console.log(`${name.padEnd(30)} HMACs ${globalThis.__hmacs}, JSON.parse calls ${parses}, of which threw ${throws}`)
}
void hmacs
