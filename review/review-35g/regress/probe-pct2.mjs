// The percent-encoded fuzz case, exactly as the fuzz built it.
import { readFileSync } from 'node:fs'
import { maskValues, HEAD_NAMES } from './h.mjs'
import { pctAll } from './gen.mjs'
const line = readFileSync(new URL('./out-fuzz-mix-11.jsonl', import.meta.url), 'utf8').split('\n').find(l => l.includes('QGex5@o9ateVU'))
const d = JSON.parse(line)
const v = pctAll(d.text)
console.log(d.wrap, 'len', v.length)
console.log(JSON.stringify(d.text))
const out = maskValues([v])
for (const h of HEAD_NAMES) console.log(h, out[h][0].slice(0, 120))
