// Hand mutants of 4a284f9's round-4 code in lib/data-diff.mjs; each
// non-equivalent one must fail test/data-diff.test.mjs at 4a284f9. Each run
// is its own process group (detached), killed whole on timeout. Up to PAR
// mutants run at once, each in its own directory. Failing tests are listed
// with their messages, so a timing flake under load can be told apart.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { spawn } from 'node:child_process'
const DIR = new URL('.', import.meta.url).pathname
const ORIG = readFileSync(DIR + 'repo/lib/data-diff.mjs', 'utf8')
const arg = process.argv[2]?.startsWith('@') ? readFileSync(DIR + process.argv[2].slice(1), 'utf8').trim() : process.argv[2]
const only = arg ? new RegExp(arg) : null
const PAR = Number(process.env.PAR ?? 2)
const TIMEOUT = 300_000
const NODE = process.env.NODE_BIN ?? process.execPath

const R = String.raw
const mutants = [
  // round 4's 16 surviving non-equivalent mutants, adapted to 4a284f9's source
  ['r4: scan: no &apos;', '&(?:quot|apos|', '&(?:quot|'],
  ['r4: scan: no hex entity', '|#x0{0,4}2[27]);', ');'],
  ['r4: scan: QUOTE run cut to one', R`(?:\\*["'\x60]|&`, R`(?:\\?["'\x60]|&`],
  ['r4: enc: only short cells', 'if (isTwice(value)) return { ...cellOfJsonText(toJson(held, where, 0)), enc: 2 }', 'if (isTwice(value) && toJson(held, where, 0).length <= MAX_TEXT) return { ...cellOfJsonText(toJson(held, where, 0)), enc: 2 }'],
  ['r4: enc: enc 1 for plain too', '      value = held\n', '      return { ...cellOfJsonText(toJson(held, where, 0)), enc: 1 }\n'],
  ['r4: pair: at most 2 keys', '  if (!strict && keys.length > 6) return null', '  if (!strict && keys.length > 2) return null'],
  ['r4: pair: any number of keys', '  if (!strict && keys.length > 6) return null\n', '\n'],
  ['r4: pair: name need not be a string', "PAIR_NAMES.has(lower) && typeof obj[k] === 'string') name = obj[k]", 'PAIR_NAMES.has(lower)) name = String(obj[k])'],
  ['r4: pair: null value masked', "else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) values.push(k)", 'else if (PAIR_VALUES.has(lower)) values.push(k)'],
  ['r4: pair: last value key wins', "else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) values.push(k)", "else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) values.splice(0, values.length, k)"],
  ['r4: omitted: thrown read as 0', 'problems: [`the snapshot could not be read: ${String(err?.message ?? err)}`], omitted: null }', 'problems: [`the snapshot could not be read: ${String(err?.message ?? err)}`], omitted: 0 }'],
  ['r4: divergence: only PR omitted unknown', "if (b?.omitted || p?.omitted) status = 'unknown'", "if (p?.omitted) status = 'unknown'"],
  ['r4: order: cleared not late', "f.kind === 'unverified' || f.kind === 'cleared' ? 2 : 1)", "f.kind === 'unverified' ? 2 : 1)"],
  ['r4: cap: key not charged', 'let size = sizeOf(named) + sizeOf(fields)', 'let size = sizeOf(fields)'],
  ['r4: cap: count-only charged its fields', 'const countOnly = { size: 0,', 'const countOnly = { size: sizeOf(fields),'],
  ['r4: url: token alone from 8', R`|([^\s/:@]{16,256}))@/gi`, R`|([^\s/:@]{8,256}))@/gi`],
  ['r4: url: token alone from 15', R`|([^\s/:@]{16,256}))@/gi`, R`|([^\s/:@]{15,256}))@/gi`],
]

function run(dir) {
  return new Promise(resolve => {
    const child = spawn(NODE, [...(process.env.SKIP ? ['--test-skip-pattern=is linear'] : []), '--test', '--test-force-exit', '--test-reporter=spec', 'test/data-diff.test.mjs'], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, TIMEOUT)
    child.on('close', (code, signal) => { clearTimeout(timer); try { process.kill(-child.pid, 'SIGKILL') } catch {} ; resolve({ code, signal, out }) })
  })
}

const todo = mutants.filter(([name]) => !only || only.test(name))
if (process.env.DRY) {
  for (const [name, from, to] of todo) {
    const n = ORIG.split(from).length - 1
    if (n !== 1) { console.log(`found ${n}x: ${name}`); continue }
    try { await import('data:text/javascript,' + encodeURIComponent(ORIG.replace(from, () => to).replace("import { createHmac } from 'node:crypto'", "import { createHmac } from 'crypto'"))) } catch (e) { console.log(`does not load: ${name}: ${e.message}`) }
  }
  console.log('dry run done', todo.length)
  process.exit(0)
}
const results = new Map()
let next = 0
async function worker(w) {
  const dir = `${DIR}mut/r4w${w}`
  mkdirSync(dir + '/lib', { recursive: true })
  mkdirSync(dir + '/test', { recursive: true })
  cpSync(DIR + 'repo/test/data-diff.test.mjs', dir + '/test/data-diff.test.mjs')
  cpSync(DIR + 'repo/package.json', dir + '/package.json')
  while (next < todo.length) {
    const [name, from, to] = todo[next++]
    const n = ORIG.split(from).length - 1
    if (n !== 1) { results.set(name, `SKIP (found ${n}x)`); console.log(`SKIP (found ${n}x) | ${name}`); continue }
    writeFileSync(dir + '/lib/data-diff.mjs', ORIG.replace(from, () => to))
    const t = performance.now()
    const r = await run(dir)
    const which = [...r.out.matchAll(/^✖ (.*?) \(\d/gm)].map(m => m[1].slice(0, 50))
    const msgs = [...r.out.matchAll(/AssertionError \[ERR_ASSERTION\]: (.*)/g)].map(m => m[1].slice(0, 40))
    const verdict = r.signal === 'SIGKILL' ? 'killed (timeout)' : r.code === 0 ? 'SURVIVED' : `killed`
    const line = `${verdict} ${JSON.stringify([...new Set(which)].slice(0, 3))} ${JSON.stringify(msgs.slice(0, 3))} ${((performance.now() - t) / 1000).toFixed(0)}s`
    results.set(name, line)
    console.log(`${line.slice(0, 260)} | ${name}`)
  }
}
await Promise.all(Array.from({ length: PAR }, (_, w) => worker(w)))
console.log('---')
for (const [name] of todo) console.log(`${(results.get(name) ?? '').slice(0, 16).padEnd(18)} ${name}`)
console.log('total', todo.length, 'survived', [...results.values()].filter(r => r.startsWith('SURVIVED')).length, 'skipped', [...results.values()].filter(r => r.startsWith('SKIP')).length)
