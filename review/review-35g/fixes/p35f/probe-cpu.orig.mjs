// E3: CPU per 256 KB text cell for shapes aimed at the patterns this round
// added, at 4a284f9 and 7193877 (process.cpuUsage, best of 3, so load on
// the machine skews it less than wall time).
import * as NEW from './repo/lib/data-diff.mjs'
import * as OLD from './old79/data-diff.mjs'
const CELL = 256 * 1024
const fill = unit => unit.repeat(Math.ceil(CELL / unit.length)).slice(0, CELL)
const shapes = {
  'plain words': fill('lorem ipsum '),
  '<a  (tag, fixed this round)': fill('<a '),
  '<a:a ': fill('<a:a '),
  'a: (Go DSN start at every word)': fill('a:'),
  'a:b (DSN, longer)': fill('ab:cd '),
  'mysql  (lazy {0,256}? per client name)': fill('mysql '),
  'mysql -x ': fill('mysql -x '),
  '<a b="1"  (ATTR_TAG, no >)': fill('<a b="1" '),
  '<a key="pw" value="x"> (attr HMAC each)': fill('<a key="pw" value="x">'),
  'JWT each 24 chars': fill('eyJabcd.eyJabcd.abcd '),
  '--a  (flag each)': fill('--a '),
  'x%3D (percent sep)': fill('x%3D'),
  'key + 32 spaces, no =': fill('a' + ' '.repeat(32)),
  'a://:@ (empty user and password)': fill('a://:@'),
  'Basic abcdefgh (auth check each)': fill('Basic abcdefgh '),
}
const mk = lib => {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: Buffer.alloc(32, 7), rules })
  return v => lib.sanitizeSnapshot({ collections: { t: { key: null, rows: [{ v }] } } }, { masker, rules })
}
const snaps = { new: mk(NEW), old: mk(OLD) }
const cpu = f => {
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const t = process.cpuUsage()
    f()
    const d = process.cpuUsage(t)
    best = Math.min(best, (d.user + d.system) / 1000)
  }
  return best
}
for (const [label, v] of Object.entries(shapes)) {
  const n = cpu(() => snaps.new(v))
  const o = cpu(() => snaps.old(v))
  const kept = snaps.new(v).collections.t.rows[0].v
  console.log(`${label.padEnd(44)} new ${n.toFixed(1).padStart(7)} ms  old ${o.toFixed(1).padStart(7)} ms  x${(n / o).toFixed(1).padStart(5)}  per 32 MB (128 cells) new ~${(n * 128 / 1000).toFixed(1)} s  kept ${JSON.stringify(kept).slice(0, 60)}`)
}
