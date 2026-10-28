// Load the PR's masking corpus (test/data-masking-corpus.test.mjs at 4033285)
// as data, and run each case at all five heads.
// Reports: known misses masked at any head; non-misses shown at any head
// (informational); 35f corpus.mjs entries missing or changed in the test.
import { readFileSync, writeFileSync } from 'node:fs'
import { M, OLD, NEW, leaks } from './h.mjs'

const src = readFileSync(new URL('./v4033285/data-masking-corpus.test.mjs', import.meta.url), 'utf8')
const start = src.indexOf('const S = ')
const end = src.indexOf("test('the masking corpus")
const body = src.slice(start, end)
writeFileSync(new URL('./corpus-data.mjs', import.meta.url), `${body}\nexport { cells, rows, KNOWN_MISSES, S, H, tok, b64 }\n`)
const C = await import('./corpus-data.mjs')

const heads = [...OLD, NEW]
const status = {}
for (const [kind, table] of [['cell', C.cells], ['row', C.rows]]) {
  for (const [name, [v, ...secrets]] of Object.entries(table)) {
    const st = {}
    const outs = {}
    for (const h of heads) {
      let out
      try { out = kind === 'cell' ? M[h].cell(v) : M[h].row(v) } catch (e) { out = `THROW ${e.message}` }
      outs[h] = out
      st[h] = leaks(out, secrets).length ? 'CLEAR' : 'ok'
    }
    status[`${kind}:${name}`] = { st, outs, known: C.KNOWN_MISSES.has(name) }
  }
}
let n = 0
console.log('== known misses, status per head', heads.join(' '))
for (const [k, { st, outs, known }] of Object.entries(status)) {
  if (!known) continue
  const anyOk = heads.some(h => st[h] === 'ok')
  console.log(`${anyOk ? 'MASKED-SOMEWHERE' : 'miss-all       '} ${k.padEnd(32)} ${heads.map(h => st[h].padEnd(5)).join(' ')}  ${outs[NEW].slice(0, 140)}`)
}
console.log('== non-misses CLEAR at some head (info)')
for (const [k, { st, outs, known }] of Object.entries(status)) {
  if (known) continue
  n++
  if (st[NEW] === 'CLEAR') console.log(`!!! NEW-HEAD CLEAR ${k} ${outs[NEW].slice(0, 200)}`)
}
const regress = Object.entries(status).filter(([, { st }]) => st[NEW] === 'CLEAR' && OLD.some(h => st[h] === 'ok'))
console.log('regressions (CLEAR at new head, ok at an old head):', regress.map(([k]) => k))
console.log('cases', Object.keys(status).length, 'non-miss', n, 'known', C.KNOWN_MISSES.size)
