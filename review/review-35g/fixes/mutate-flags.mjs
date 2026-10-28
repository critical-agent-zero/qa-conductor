// Mutants of this round's flag code and round 6's named survivors.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
const D = new URL('./', import.meta.url).pathname
const src = readFileSync(`${D}v4033285/data-diff.mjs`, 'utf8')
const corpus = readFileSync(`${D}repo/test/data-masking-corpus.test.mjs`, 'utf8')
const dd = readFileSync(`${D}repo/test/data-diff.test.mjs`, 'utf8')
const M = [
  ['leftout:no-pr-lacks', `return c === undefined || Boolean(c.omitted) ||`, `return Boolean(c?.omitted) ||`],
  ['leftout:no-omitted', `return c === undefined || Boolean(c.omitted) ||`, `return c === undefined ||`],
  ['leftout:omitted-after-only', `return c === undefined || Boolean(c.omitted) ||`, `return c === undefined || c.omitted === 'after' ||`],
  ['leftout:no-cut-short', ` || (Boolean(c.truncated) && b !== undefined && !b.truncated)\n`, `\n`],
  ['leftout:cut-short-ignores-base', `(Boolean(c.truncated) && b !== undefined && !b.truncated)`, `(Boolean(c.truncated))`],
  ['leftout:null-fold-too', `if (f.kind !== 'unverified' || typeof f.collection !== 'string') return false`, `if (f.kind !== 'unverified') return false`],
  ['fieldsBefore:from-after', `    fieldsBefore: b?.fields ?? null,`, `    fieldsBefore: a?.fields ?? null,`],
  ['cols:others-unsorted', `const others = mine.items.filter(f => !declared.has(f)).sort()`, `const others = mine.items.filter(f => !declared.has(f))`],
  ['cols:seeded-unsorted', `const seeded = mine.items.filter(f => declared.has(f)).sort()`, `const seeded = mine.items.filter(f => declared.has(f))`],
  ['cols:no-seeded-first', `fields: [...seeded, ...others].slice(0, 5)`, `fields: [...mine.items].sort().slice(0, 5)`],
  ['cleared:merge-keeps-last', `else if (was.items !== null && items !== null) { merged = was.items; for (const item of items) merged.push(item) }`, `else if (was.items !== null && items !== null) { merged = items }`],
  ['strip:no-r', `m[1].replace(/^[nrt]/, '')`, `m[1].replace(/^[nt]/, '')`],
  ['pair:soft-guard', `const as = secret && named !== 'plain' ? 'secret' : named`, `const as = secret ? 'secret' : named`],
]
rmSync(`${D}mutf`, { recursive: true, force: true })
const list = []
for (const [id, a, b] of M) {
  const n = src.split(a).length - 1
  if (n !== 1) { console.log(`SKIP ${id}: ${n}`); continue }
  const dir = `${D}mutf/${id.replace(/[^\w.-]/g, '_')}`
  mkdirSync(`${dir}/lib`, { recursive: true }); mkdirSync(`${dir}/test`, { recursive: true })
  writeFileSync(`${dir}/lib/data-diff.mjs`, src.replace(a, () => b))
  writeFileSync(`${dir}/test/data-masking-corpus.test.mjs`, corpus)
  writeFileSync(`${dir}/test/data-diff.test.mjs`, dd)
  list.push(id.replace(/[^\w.-]/g, '_'))
}
writeFileSync(`${D}mutf/list.txt`, list.join('\n') + '\n')
console.log(`${list.length} mutants`)
