// Spot mutants of 2b8379d's own code in lib/data-capture.mjs. Each runs
// data-capture's tests, then server, session and demo tests if it survives,
// in its own process group with a hard timeout; the file is restored after.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const REPO = new URL('../repo/', import.meta.url).pathname
const FILE = `${REPO}lib/data-capture.mjs`
const original = readFileSync(FILE, 'utf8')
const mutants = {
  'diff entry skipped, no stop (pr/base)': ['if (size > budget.left) { stopped = true; break }\n          budget.left -= size\n          let cut = false', 'if (size > budget.left) { list.done++; continue }\n          budget.left -= size\n          let cut = false'],
  'divergence changes cut not marked': ['changesCount: changes.length, ...(cut ? { cut: true } : {})', 'changesCount: changes.length'],
  'diff rows cut not marked': ['if (cut) value.cut = true', 'if (false) value.cut = true'],
  'divergence entry uncharged': ['const { changes, ...rest } = c\n          const size = entrySize(name, rest)', 'const { changes, ...rest } = c\n          const size = 0'],
  'flags after lists': ['const listedFlagsOut = listedFlags(flags, budget)\n      const out = listedLists({ pr, divergence: base && pr ? div() : null, base }, budget, { order, red: reds })', 'const out = listedLists({ pr, divergence: base && pr ? div() : null, base }, budget, { order, red: reds })\n      const listedFlagsOut = listedFlags(flags, budget)'],
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
