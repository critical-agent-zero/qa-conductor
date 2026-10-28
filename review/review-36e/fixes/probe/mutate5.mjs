// Round 5 hand mutants for PR #36's own commit 2b8379d (c7059bb..2b8379d):
// the round-4 survivors re-made for the new code, and the new ranking,
// tiers-across-lists, cut marker, byte budget and reason. Each is applied
// alone to ../mut. The data-capture test runs first; a survivor then runs
// the session, server and demo tests too. Each run is its own process group,
// killed whole on timeout.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', 'mut')
const FIRST = ['test/data-capture.test.mjs']
const REST = ['test/session.test.mjs', 'test/server.test.mjs', 'test/demo.test.mjs']
const DC = 'lib/data-capture.mjs'

const LISTS_AND_FLAGS = "      const listedFlagsOut = listedFlags(flags, budget)\n      const out = listedLists({ pr, divergence: base && pr ? div() : null, base }, budget, { order, red: reds })"
const DIV_CHARGE = "          if (size > budget.left) { stopped = true; break }\n          budget.left -= size\n          const { out, cut } = within(changes, LISTED, budget)"
const DIFF_CHARGE = "          if (size > budget.left) { stopped = true; break }\n          budget.left -= size\n          let cut = false"
const MUTANTS = [
  // round 4's survivors, re-made
  ['M28 order: flags after the lists', DC, LISTS_AND_FLAGS, "      const out = listedLists({ pr, divergence: base && pr ? div() : null, base }, budget, { order, red: reds })\n      const listedFlagsOut = listedFlags(flags, budget)"],
  ['M22 divergence rank: counts ignored', DC, 'const divergenceMoved = c => c.changes.length > 0 || [c.counts.base, c.counts.pr].some(n => n.inserted + n.updated + n.deleted > 0)', 'const divergenceMoved = c => c.changes.length > 0'],
  ['M23 divergence rank: nothing moved', DC, 'const divergenceMoved = c => c.changes.length > 0 || [c.counts.base, c.counts.pr].some(n => n.inserted + n.updated + n.deleted > 0)', 'const divergenceMoved = () => false'],
  ['M4 divergence: never cut', DC, '...(stopped && list.done < list.todo.length ? { cut: true } : {})', "...(stopped && list.done < list.todo.length && list.which !== 'divergence' ? { cut: true } : {})"],
  ['M11 fallback: amber flags too', DC, "...flags.filter(f => f.severity === 'red').slice(0, FALLBACK_FLAGS)", '...flags.slice(0, FALLBACK_FLAGS)'],
  ['M12 fallback: no flag cap', DC, 'const FALLBACK_FLAGS = 20', 'const FALLBACK_FLAGS = Infinity'],
  ['M18 rank: status change ignored', DC, 'changed ? 3 : 4, 0]', 'changed ? 4 : 4, 0]'],
  ['M24 rowsChanged: keyLost ignored', DC, 'c.fieldsAdded.length > 0 || c.keyLost', 'c.fieldsAdded.length > 0'],
  ['M25 rowsChanged: fields ignored', DC, 'c.deleted.length + c.fieldsDropped.length + c.fieldsAdded.length > 0', 'c.deleted.length > 0'],
  ['M30 fold: the PR-only flag folded too', DC, "f.kind === 'unverified' && f.collection !== null && ++named", "f.kind === 'unverified' && ++named"],
  ['M44 ready: baselineAt only when both settle', DC, '    if (reads.some(r => r.snap)) baselineAt = at', '    if (reads.every(r => r.snap)) baselineAt = at'],
  // the byte budget
  ['N1 bytes: UTF-16 characters', DC, 'const bytesOf = value => Buffer.byteLength(JSON.stringify(value))', 'const bytesOf = value => JSON.stringify(value).length'],
  ['N2 within: items free', DC, '    const size = bytesOf(item)', '    const size = 0'],
  ['N3 entrySize: rest not charged', DC, 'bytesOf(name) + bytesOf(rest) + ENTRY_EXTRA', 'bytesOf(name) + ENTRY_EXTRA'],
  ['N4 divergence: entry not subtracted', DC, DIV_CHARGE, "          if (size > budget.left) { stopped = true; break }\n          const { out, cut } = within(changes, LISTED, budget)"],
  ['N5 diff: entry not subtracted', DC, DIFF_CHARGE, "          if (size > budget.left) { stopped = true; break }\n          let cut = false"],
  ['N6 diff: skip, not stop', DC, DIFF_CHARGE, "          if (size > budget.left) { list.done++; continue }\n          budget.left -= size\n          let cut = false"],
  ['N7 divergence: skip, not stop', DC, DIV_CHARGE, "          if (size > budget.left) { list.done++; continue }\n          budget.left -= size\n          const { out, cut } = within(changes, LISTED, budget)"],
  // the rank by flag order
  ['N8 rank: red ties by name', DC, 'if (red.has(name)) return [0, order.get(name)]', 'if (red.has(name)) return [0, 0]'],
  ['N9 rank: red ranked with moved', DC, 'if (red.has(name)) return [0, order.get(name)]', 'if (red.has(name)) return [1, order.get(name)]'],
  ['N10 rank: by the last flag', DC, 'if (!order.has(f.collection)) order.set(f.collection, i)', 'order.set(f.collection, i)'],
  ['N11 byRank: flag order reversed', DC, 'x.rank[1] - y.rank[1]', 'y.rank[1] - x.rank[1]'],
  ['N12 byRank: name order reversed', DC, '(x.name < y.name ? -1 : x.name > y.name ? 1 : 0)', '(x.name < y.name ? 1 : x.name > y.name ? -1 : 0)'],
  ['N13 reds: amber too', DC, "if (f.severity === 'red') reds.add(f.collection)", 'reds.add(f.collection)'],
  ['N14 reds: none', DC, "if (f.severity === 'red') reds.add(f.collection)", 'if (false) reds.add(f.collection)'],
  ['N15 rank: amber not ranked', DC, 'moved ? 1 : order.has(name) ? 2 :', 'moved ? 1 : false ? 2 :'],
  ['N16 rank: amber before moved', DC, 'moved ? 1 : order.has(name) ? 2 :', 'moved ? 2 : order.has(name) ? 1 :'],
  ['N17 candidates: no cap', DC, '    .sort(byRank)\n    .slice(0, LISTED_COLLECTIONS)', '    .sort(byRank)'],
  ['N18 candidates: no sort', DC, '    .sort(byRank)\n    .slice(0, LISTED_COLLECTIONS)', '    .slice(0, LISTED_COLLECTIONS)'],
  // the tiers across lists
  ['N19 tiers: each list whole, in turn', DC, 'list.todo[list.done].rank[0] === tier', 'list.todo[list.done].rank[0] >= tier'],
  ['N20 tiers: unchanged never listed', DC, 'tier <= 4 && !stopped', 'tier <= 3 && !stopped'],
  ['N21 lists: base first', DC, "[['pr', pr, rowsChanged], ['divergence', div, divergenceMoved], ['base', base, rowsChanged]]", "[['base', base, rowsChanged], ['divergence', div, divergenceMoved], ['pr', pr, rowsChanged]]"],
  ['N22 lists: divergence ranked as a diff', DC, "['divergence', div, divergenceMoved]", "['divergence', div, () => true]"],
  // the cut marker
  ['N23 cut: whenever stopped', DC, '...(stopped && list.done < list.todo.length ? { cut: true } : {})', '...(stopped ? { cut: true } : {})'],
  ['N24 cut: whenever more', DC, '...(stopped && list.done < list.todo.length ? { cut: true } : {})', '...(list.done < list.todo.length ? { cut: true } : {})'],
  ['N25 cut: never', DC, '...(stopped && list.done < list.todo.length ? { cut: true } : {})', '...({})'],
  ['N26 collectionsCount: of the listed', DC, 'collectionsCount: Object.keys(list.d.collections).length', 'collectionsCount: Object.keys(list.collections).length'],
  // the reason
  ['N27 reason: baseline not first', DC, "[unreadable(why === 'baseline' ? 'baseline' : base ? why ?? 'failed' : 'neither')]", "[unreadable(base ? why ?? 'failed' : 'neither')]"],
  ['N28 reason: never baseline', DC, "fresh.pr ? 'baseline' : 'failed'", "'failed'"],
  ['N29 reason: never neither', DC, "[unreadable(why === 'baseline' ? 'baseline' : base ? why ?? 'failed' : 'neither')]", "[unreadable(why === 'baseline' ? 'baseline' : why ?? 'failed')]"],
  // the spans' divergence
  ['N30 session span: the boot divergence', DC, "fresh.pr ? 'baseline' : 'failed', () => divergence(session.base, session.pr))", "fresh.pr ? 'baseline' : 'failed', () => divergence(boot.base ?? session.base, boot.pr ?? session.pr))"],
]

function run(files) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', '--test-force-exit', '--test-concurrency=1', ...files], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 300_000)
    child.on('close', code => {
      clearTimeout(timer)
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
      const fail = /ℹ fail (\d+)/.exec(out)?.[1]
      const failing = [...out.matchAll(/^✖ (.+?) \(\d/mg)].map(m => m[1]).filter(n => !/^test\//.test(n)).slice(0, 2)
      resolve({ fail: fail === undefined ? `? (exit ${code})` : Number(fail), failing })
    })
  })
}

const only = process.argv[2]
const original = readFileSync(path.join(ROOT, DC), 'utf8')
for (const [name, ...edits] of MUTANTS) {
  if (only && !only.split(',').includes(name.split(' ')[0])) continue
  const saved = new Map()
  let ok = true
  for (let i = 0; i < edits.length; i += 3) {
    const [file, from, to] = edits.slice(i, i + 3)
    const abs = path.join(ROOT, file)
    if (!saved.has(abs)) saved.set(abs, readFileSync(abs, 'utf8'))
    const cur = readFileSync(abs, 'utf8')
    const n = cur.split(from).length - 1
    if (n !== 1) { console.log(`${name}: SKIP (pattern found ${n}x in ${file})`); ok = false; break }
    writeFileSync(abs, cur.replace(from, to))
  }
  if (ok) {
    let r = await run(FIRST)
    if (r.fail === 0) r = await run(REST)
    console.log(`${name}: ${r.fail === 0 ? 'SURVIVED' : `killed (${r.fail} failing)`}${r.failing.length ? ` — e.g. ${r.failing.join(' | ')}` : ''}`)
  }
  for (const [abs, src] of saved) writeFileSync(abs, src)
}
console.log(readFileSync(path.join(ROOT, DC), 'utf8') === original ? 'mut/lib/data-capture.mjs restored byte-identical' : 'WARNING: mut/lib/data-capture.mjs differs from the original')
