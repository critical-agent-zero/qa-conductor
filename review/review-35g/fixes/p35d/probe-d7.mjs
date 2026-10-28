// D7: what three surviving mutants let through, shown concretely: a key
// behind a run of backslashes (triple-encoded JSON text) with the run cut to
// one backslash; &apos; and hex entities dropped; enc: 2 only on short cells.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const here = new URL('.', import.meta.url).pathname
const src = readFileSync(`${here}repo/lib/data-diff.mjs`, 'utf8')
mkdirSync(`${here}mutd7`, { recursive: true })
const variants = {
  head: src,
  'run cut to one backslash': src.replace(String.raw`(?:\\*["']|&`, String.raw`(?:\\?["']|&`),
  'no &apos; and no hex entity': src.replace('&(?:quot|apos|', '&(?:quot|').replace('|#x0{0,4}2[27]);', ');'),
  'enc only on short cells': src.replace('if (isTwice(value)) return { ...cellOfJsonText(toJson(held, where, 0)), enc: 2 }', 'if (isTwice(value) && toJson(held, where, 0).length <= MAX_TEXT) return { ...cellOfJsonText(toJson(held, where, 0)), enc: 2 }'),
}
const triple = JSON.stringify(JSON.stringify(JSON.stringify({ password: 'triple-secret-9', user: 'a' })))
const cases = {
  triple: [`log: ${triple}`, 'triple-secret-9'],
  dblEscaped: ['msg=\\\\"password\\\\": \\\\"dbl-esc-9\\\\"', 'dbl-esc-9'],
  apos: ['cfg=&apos;password&apos;: &apos;apos-secret-9&apos;', 'apos-secret-9'],
  hex: ['cfg=&#x27;password&#x27;: &#x27;hex-secret-9&#x27;', 'hex-secret-9'],
}
let i = 0
for (const [label, code] of Object.entries(variants)) {
  const file = `${here}mutd7/v${i++}.mjs`
  writeFileSync(file, code)
  const E = await import(file)
  const rules = E.validateRules({})
  const masker = E.createMasker({ key: Buffer.alloc(32, 7), rules })
  const [row] = E.sanitizeSnapshot({ collections: { c: { key: ['id'], rows: [{ id: 1, ...Object.fromEntries(Object.entries(cases).map(([k, [v]]) => [k, v])) }] } } }, { masker, rules }).collections.c.rows
  const shown = Object.entries(cases).map(([k, [, s]]) => `${k}:${JSON.stringify(row[k]).includes(s) ? 'CLEAR' : 'ok'}`)
  const big = JSON.stringify({ theme: 'dark', blob: 'x'.repeat(300) })
  const s0 = E.sanitizeSnapshot({ collections: { p: { key: ['id'], rows: Array.from({ length: 30 }, (_, j) => ({ id: j + 1, v: big })) } } }, { masker, rules })
  const s1 = E.sanitizeSnapshot({ collections: { p: { key: ['id'], rows: Array.from({ length: 30 }, (_, j) => ({ id: j + 1, v: JSON.stringify(big) })) } } }, { masker, rules })
  console.log(`${label.padEnd(28)} ${shown.join(' ')}; long plain->double updates ${E.diffSnapshots(s0, s1).collections.p.updated.length}`)
}
