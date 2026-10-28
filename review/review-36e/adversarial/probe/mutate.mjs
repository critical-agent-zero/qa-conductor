// Spot mutants of 2b8379d's own code in lib/data-capture.mjs. Each runs
// data-capture's tests, then server, session and demo tests if it survives,
// in its own process group with a hard timeout; the file is restored after.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const REPO = new URL('../repo/', import.meta.url).pathname
const FILE = `${REPO}lib/data-capture.mjs`
const original = readFileSync(FILE, 'utf8')
const mutants = {
  'rank ignores flag order (red ties by name)': ['if (red.has(name)) return [0, order.get(name)]', 'if (red.has(name)) return [0, 0]'],
  'whole lists in turn (no tiers)': ['list.todo[list.done].rank[0] === tier', 'list.todo[list.done].rank[0] >= tier'],
  'budget counts UTF-16 units': ['const bytesOf = value => Buffer.byteLength(JSON.stringify(value))', 'const bytesOf = value => JSON.stringify(value).length'],
  'reason: old order': ["why === 'baseline' ? 'baseline' : base ? why ?? 'failed' : 'neither'", "base ? why ?? 'failed' : 'neither'"],
  'cut on every list once stopped': ['...(stopped && list.done < list.todo.length ? { cut: true } : {})', '...(stopped ? { cut: true } : {})'],
  'order by last flag': ['if (!order.has(f.collection)) order.set(f.collection, i)', 'order.set(f.collection, i)'],
  'amber counts as red': ["if (f.severity === 'red') reds.add(f.collection)", 'reds.add(f.collection)'],
  'base list first': ["[['pr', pr, rowsChanged], ['divergence', div, divergenceMoved], ['base', base, rowsChanged]]", "[['base', base, rowsChanged], ['divergence', div, divergenceMoved], ['pr', pr, rowsChanged]]"],
  'divergence before pr': ["[['pr', pr, rowsChanged], ['divergence', div, divergenceMoved], ['base', base, rowsChanged]]", "[['divergence', div, divergenceMoved], ['pr', pr, rowsChanged], ['base', base, rowsChanged]]"],
  'no tie-break on flag index': ['x.rank[0] - y.rank[0] || x.rank[1] - y.rank[1] ||', 'x.rank[0] - y.rank[0] ||'],
  'entry extra 0': ['const ENTRY_EXTRA = 200', 'const ENTRY_EXTRA = 0'],
  'tiers stop at 3 (no "none" tier)': ['tier <= 4 && !stopped', 'tier <= 3 && !stopped'],
  'stop skips only the entry (continue past)': ['if (size > budget.left) { stopped = true; break }\n          budget.left -= size\n          const { out, cut }', 'if (size > budget.left) { list.done++; continue }\n          budget.left -= size\n          const { out, cut }'],
}
const run = files => spawnSync('perl', ['-e', 'setpgrp(0,0); alarm shift; exec @ARGV', '600', 'node', '--test', '--test-force-exit', '--test-timeout=120000', ...files], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const failed = r => r.status !== 0
try {
  for (const [name, [from, to]] of Object.entries(mutants)) {
    if (!original.includes(from)) { console.log(`?? ${name}: pattern not found`); continue }
    writeFileSync(FILE, original.replace(from, to))
    let r = run(['test/data-capture.test.mjs'])
    let where = 'data-capture'
    if (!failed(r)) { r = run(['test/server.test.mjs', 'test/session.test.mjs', 'test/demo.test.mjs']); where = 'server/session/demo' }
    const fails = (r.stdout.match(/^not ok \d+ - .*$/gm) ?? []).concat(r.stdout.match(/^✖ .*$/gm) ?? []).slice(0, 2)
    console.log(`${failed(r) ? 'KILLED' : 'ALIVE '} ${name}${failed(r) ? ` (by ${where}: ${fails[0]?.slice(0, 120) ?? `exit ${r.status}`})` : ''}`)
  }
} finally {
  writeFileSync(FILE, original)
}
