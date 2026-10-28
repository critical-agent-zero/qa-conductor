// D3: the new TAG_IN_TEXT lets each '<' read up to 256 characters of
// attributes, '<' included, so in text dense with '<a ' every character is
// read about 85 times. One snapshot of N such cells of 256 KB, at 7193877,
// at 2ec0bba, and with the attributes kept from crossing another '<'
// (tagfix/), against the same bytes of plain words.
import * as NEW from './repo/lib/data-diff.mjs'
import * as OLD from './old2ec/data-diff.mjs'
import * as FIX from './tagfix/data-diff.mjs'

const N = Number(process.argv[2] ?? 128)
const K = 256 * 1024
const shapes = {
  "'<a ' text": '<a '.repeat(Math.floor(K / 3)),
  "'<a:b ' text": '<a:b '.repeat(Math.floor(K / 5)),
  'plain words': 'abcdefgh '.repeat(Math.floor(K / 9)),
}
for (const [shape, cellText] of Object.entries(shapes)) {
  for (const [label, lib] of [['7193877', NEW], ['2ec0bba', OLD], ['tag fix', FIX]]) {
    const rules = lib.validateRules({})
    const masker = lib.createMasker({ key: Buffer.alloc(32, 7), rules })
    // N rows, each a distinct cell (a row number in front), so nothing is shared
    const rows = Array.from({ length: N }, (_, i) => ({ id: i + 1, body: `${i} ${cellText}` }))
    const t0 = performance.now()
    const out = lib.sanitizeSnapshot({ collections: { notes: { key: ['id'], rows } } }, { masker, rules })
    const ms = performance.now() - t0
    console.log(`${label} ${shape.padEnd(14)} ${N} cells x ${(cellText.length / 1024).toFixed(0)} KB (${(N * cellText.length / 1048576).toFixed(0)} MB raw): ${(ms / 1000).toFixed(2)} s; kept ${out.collections.notes.rows.length} rows, ${(JSON.stringify(out).length / 1048576).toFixed(2)} MB`)
  }
}
