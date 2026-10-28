// CPU and wall time of the tag timing test's work (24 cells of 256 KB of
// `<a ` and `<a:a `) at 7193877, 4a284f9 and 4ed6449, and a 256 KB `a:` cell
// (the DSN test), best of 3.
import * as R4 from '../old79/data-diff.mjs'
import * as R5 from '../old4a/data-diff.mjs'
import * as H from '../head/data-diff.mjs'
const a = '<a '.repeat(87_000)
const ns = '<a:a '.repeat(52_000)
const rows = Array.from({ length: 20 }, (_, id) => ({ id, v: a })).concat(Array.from({ length: 4 }, (_, id) => ({ id: 20 + id, v: ns })))
const colon = [{ id: 1, v: 'a:'.repeat(128 * 1024) }]
const nl = [{ id: 1, v: `${'\\n'.repeat(128 * 1024)}=` }]
for (const [label, lib] of [['7193877', R4], ['4a284f9', R5], ['4ed6449', H]]) {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: Buffer.alloc(32, 7), rules })
  const snap = r => lib.sanitizeSnapshot({ collections: { c: { key: ['id'], rows: r } } }, { masker, rules })
  for (const [what, r] of [['tags x24', rows], ['a: x1', colon], ['\\n x1', nl]]) {
    let bestCpu = Infinity
    let bestWall = Infinity
    for (let i = 0; i < 3; i++) {
      const c0 = process.cpuUsage()
      const w0 = performance.now()
      snap(r)
      const c = process.cpuUsage(c0)
      bestCpu = Math.min(bestCpu, (c.user + c.system) / 1000)
      bestWall = Math.min(bestWall, performance.now() - w0)
    }
    console.log(`${label} ${what.padEnd(9)} cpu ${bestCpu.toFixed(0)} ms, wall ${bestWall.toFixed(0)} ms`)
  }
}
