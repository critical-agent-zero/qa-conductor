// Compare the PR's corpus tables with review-35f's corpus.mjs tables (name
// and value), and run 35f corpus at all five heads.
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { M, OLD, NEW, leaks } from './h.mjs'

const src = readFileSync(new URL('./p35f/corpus.mjs', import.meta.url), 'utf8')
const body = src.slice(src.indexOf('const S = '), src.indexOf('const order = '))
writeFileSync(new URL('./corpus35f-data.mjs', import.meta.url), `${body.replace(/^export const /gm, 'const ')}\nexport { cells, rows }\n`)
const F = await import('./corpus35f-data.mjs')
const C = await import('./corpus-data.mjs')

for (const [kind, a, b] of [['cell', F.cells, C.cells], ['row', F.rows, C.rows]]) {
  for (const [name, v] of Object.entries(a)) {
    if (!Object.hasOwn(b, name)) { console.log(`MISSING-IN-TEST ${kind}:${name} ${JSON.stringify(v).slice(0, 160)}`); continue }
    if (!isDeepStrictEqual(v, b[name])) console.log(`CHANGED ${kind}:${name}\n  35f  ${JSON.stringify(v).slice(0, 200)}\n  test ${JSON.stringify(b[name]).slice(0, 200)}`)
  }
  for (const name of Object.keys(b)) if (!Object.hasOwn(a, name)) console.log(`ADDED-IN-TEST ${kind}:${name} ${JSON.stringify(b[name]).slice(0, 160)}`)
}
console.log('35f cells', Object.keys(F.cells).length, 'rows', Object.keys(F.rows).length, '| test cells', Object.keys(C.cells).length, 'rows', Object.keys(C.rows).length)
