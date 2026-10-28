// Round 4 hand mutants for PR #36's round-3 fix commit (875cc7b..7055c24),
// plus the round-3 survivors re-made for the new code. Each is applied alone
// to ../mut. The data-capture test runs first; a survivor then runs the
// session, server and demo tests too. Each run is its own process group,
// killed whole on timeout.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', 'mut')
const FIRST = ['test/data-capture.test.mjs']
const REST = ['test/session.test.mjs', 'test/server.test.mjs', 'test/demo.test.mjs']
const DC = 'lib/data-capture.mjs'

const MUTANTS = [
  // round 3's survivors, re-made
  ['R19 divergence: no 50-change cut (N40)', DC, 'const { out, cut } = within(changes, LISTED, budget)', 'const { out, cut } = within(changes, Infinity, budget)'],
  ['R20 divergence: no changesCount (N41)', DC, 'changes: out, changesCount: changes.length, ', 'changes: out, '],
  ['N11 divergence: no cut marker', DC, 'changesCount: changes.length, ...(cut ? { cut: true } : {}) })', 'changesCount: changes.length })'],
  ['N12 divergence: changesCount from the cut list', DC, 'changesCount: changes.length,', 'changesCount: out.length,'],
  ['N42 divergence: outside the budget', DC, 'const { out, cut } = within(changes, LISTED, budget)', 'const { out, cut } = within(changes, LISTED, { left: Infinity })'],
  ['N15 flags: outside the budget', DC, 'LISTED_FLAGS, budget).out', 'LISTED_FLAGS, { left: Infinity }).out'],
  ['N17 view: each span the whole budget', DC, 'Math.floor(viewBytes / 2)', 'viewBytes'],
  ['N38 rebaseline: settle uses an old run number', DC, '{ settle(pane, reads[i].snap, run, at); fresh[pane] = false }', '{ settle(pane, reads[i].snap, 1, at); fresh[pane] = false }'],
  // the entry charge and the stop
  ['M1 listed: entry not charged', DC, '    const size = entrySize(name, rest)\n    if (size > budget.left) { stopped = true; break }\n    budget.left -= size\n    let cut = false', '    let cut = false'],
  ['M2 divergence: entry not charged', DC, '    const size = entrySize(name, rest)\n    if (size > budget.left) { stopped = true; break }\n    budget.left -= size\n    const { out, cut }', '    const { out, cut }'],
  ['M3 listed: stop not marked', DC, '    if (size > budget.left) { stopped = true; break }\n    budget.left -= size\n    let cut = false', '    if (size > budget.left) { break }\n    budget.left -= size\n    let cut = false'],
  ['M4 divergence: stop not marked', DC, '    if (size > budget.left) { stopped = true; break }\n    budget.left -= size\n    const { out, cut }', '    if (size > budget.left) { break }\n    budget.left -= size\n    const { out, cut }'],
  ['M5 entrySize: key and scalars not charged', DC, 'JSON.stringify(name).length + JSON.stringify(rest).length + ENTRY_EXTRA', 'JSON.stringify(name).length + ENTRY_EXTRA'],
  ['M6 entrySize: no room for counts', DC, 'const ENTRY_EXTRA = 200', 'const ENTRY_EXTRA = 0'],
  ['M7 listed: entry charged but not subtracted', DC, '    if (size > budget.left) { stopped = true; break }\n    budget.left -= size\n    let cut = false', '    if (size > budget.left) { stopped = true; break }\n    let cut = false'],
  // the fallback
  ['M8 viewJson: no fallback', DC, '      } catch {\n        try {\n          cached = { id, json: JSON.stringify(view({ isolation }, { lists: false })) }\n        } catch (error) {\n          cached = { id, error }\n        }\n      }', '      } catch (error) {\n        cached = { id, error }\n      }'],
  ['M9 fallback: no unlisted flag', DC, 'flags: [unlisted(), ...flags.filter', 'flags: [...flags.filter'],
  ['M10 fallback: flagsCount without unlisted', DC, 'flagsCount: { red: red + 1, amber', 'flagsCount: { red, amber'],
  ['M11 fallback: amber flags too', DC, "...flags.filter(f => f.severity === 'red').slice(0, FALLBACK_FLAGS)", '...flags.slice(0, FALLBACK_FLAGS)'],
  ['M12 fallback: no flag cap', DC, 'const FALLBACK_FLAGS = 20', 'const FALLBACK_FLAGS = Infinity'],
  ['M13 fallback: still lists', DC, '      if (!lists) {', '      if (false) {'],
  ['M14 unlisted: amber', DC, "kind: 'unlisted', severity: 'red'", "kind: 'unlisted', severity: 'amber'"],
  // ranking and order
  ['M15 rank: red not first', DC, "(flagged.get(name) === 'red' ? 0 : moved ? 1", "(flagged.get(name) === 'red' ? 1 : moved ? 1"],
  ['M16 rank: moved before red', DC, "(flagged.get(name) === 'red' ? 0 : moved ? 1 :", "(moved ? 0 : flagged.get(name) === 'red' ? 1 :"],
  ['M17 rank: amber before moved', DC, 'moved ? 1 : flagged.has(name) ? 2', 'moved ? 2 : flagged.has(name) ? 1'],
  ['M18 rank: status change ignored', DC, 'changed ? 3 : 4)', 'changed ? 4 : 4)'],
  ['M19 chosen: no rank sort', DC, '.sort((x, y) => x[0] - y[0] || ', '.sort((x, y) => '],
  ['M20 chosen: no cap', DC, '.slice(0, LISTED_COLLECTIONS)', '.slice(0)'],
  ['M21 view: flagged map empty', DC, '      for (const f of flags) if (f.collection !== null', '      if (false) for (const f of flags) if (f.collection !== null'],
  ['M22 divergence rank: counts ignored', DC, 'const moved = c => c.changes.length > 0 || [c.counts.base, c.counts.pr].some(n => n.inserted + n.updated + n.deleted > 0)', 'const moved = c => c.changes.length > 0'],
  ['M23 divergence rank: nothing moved', DC, 'const moved = c => c.changes.length > 0 || [c.counts.base, c.counts.pr].some(n => n.inserted + n.updated + n.deleted > 0)', 'const moved = () => false'],
  ['M24 rowsChanged: keyLost ignored', DC, 'c.fieldsAdded.length > 0 || c.keyLost', 'c.fieldsAdded.length > 0'],
  ['M25 rowsChanged: fields ignored', DC, 'c.deleted.length + c.fieldsDropped.length + c.fieldsAdded.length > 0', 'c.deleted.length > 0'],
  ['M26 order: base diff before the PR diff', DC, '      const prOut = listed(pr, budget, flagged)\n      const divOut = base && pr ? listedDivergence(divergence(base, pr), budget, flagged) : null\n      const baseOut = listed(base, budget, flagged)', '      const baseOut = listed(base, budget, flagged)\n      const prOut = listed(pr, budget, flagged)\n      const divOut = base && pr ? listedDivergence(divergence(base, pr), budget, flagged) : null'],
  ['M27 order: divergence before the PR diff', DC, '      const prOut = listed(pr, budget, flagged)\n      const divOut = base && pr ? listedDivergence(divergence(base, pr), budget, flagged) : null', '      const divOut = base && pr ? listedDivergence(divergence(base, pr), budget, flagged) : null\n      const prOut = listed(pr, budget, flagged)'],
  ['M28 order: flags after the lists', DC, '      const listedFlagsOut = listedFlags(flags, budget)\n      const prOut = listed(pr, budget, flagged)\n      const divOut = base && pr ? listedDivergence(divergence(base, pr), budget, flagged) : null\n      const baseOut = listed(base, budget, flagged)', '      const prOut = listed(pr, budget, flagged)\n      const divOut = base && pr ? listedDivergence(divergence(base, pr), budget, flagged) : null\n      const baseOut = listed(base, budget, flagged)\n      const listedFlagsOut = listedFlags(flags, budget)'],
  // the fold
  ['M29 fold: none', DC, 'const LISTED_UNVERIFIED = 20', 'const LISTED_UNVERIFIED = Infinity'],
  ['M30 fold: the PR-only flag folded too', DC, "f.kind === 'unverified' && f.collection !== null && ++named", "f.kind === 'unverified' && ++named"],
  ['M31 fold: appended at the end', DC, 'out.splice(foldAt, 0, {', 'out.splice(out.length, 0, {'],
  ['M32 fold: last five names', DC, 'names: rest.slice(0, 5)', 'names: rest.slice(-5)'],
  ['M33 fold: count is 20', DC, 'collections: rest.length, names', 'collections: LISTED_UNVERIFIED, names'],
  ['M34 fold: amber unverified folded too', DC, "    if (f.severity !== 'red') continue\n", ''],
  ['M35 fold: folded flag not red', DC, "{ collection: null, kind: 'unverified', severity: 'red', shared: false, pr: rest.length", "{ collection: null, kind: 'unverified', severity: 'amber', shared: false, pr: rest.length"],
  // problems and errors
  ['M36 problems: no cap', DC, 'problems.slice(0, LISTED_PROBLEMS)', 'problems.slice(0)'],
  ['M37 problemsCount: of the listed', DC, "pr: problemsOf('pr').length }", "pr: listedProblems(problemsOf('pr')).length }"],
  ['M38 messageOf: no cut', DC, 'return text.length > ERROR_TEXT ?', 'return false ?'],
  // alignment and baselineAt
  ['M39 boot aligned: old rule', DC, 'const bootAligned = !(boot.base && boot.pr) || (bootRun.base === readyRun && bootRun.pr === readyRun)', 'const bootAligned = both(boot, bootRun)'],
  ['M40 boot aligned: base only', DC, '(bootRun.base === readyRun && bootRun.pr === readyRun)', '(bootRun.base === readyRun)'],
  ['M41 boot aligned: PR only', DC, '(bootRun.base === readyRun && bootRun.pr === readyRun)', '(bootRun.pr === readyRun)'],
  ['M42 ready: readyRun not set', DC, '    readyRun = run\n', ''],
  ['M43 ready: baselineAt always', DC, '    if (reads.some(r => r.snap)) baselineAt = at', '    baselineAt = at'],
  ['M44 ready: baselineAt only when both settle', DC, '    if (reads.some(r => r.snap)) baselineAt = at', '    if (reads.every(r => r.snap)) baselineAt = at'],
  // the non-null span and its reason
  ['M45 boot: null with neither pane', DC, "span(boot.base, boot.pr, bootAligned, runs > 0 ? 'failed' : null)", 'span(boot.base, boot.pr, bootAligned, null)'],
  ['M46 span: null with neither pane', DC, 'if (!base && !pr && why === null) return null', 'if (!base && !pr) return null'],
  ['M47 reason: never neither', DC, "[unreadable(base ? why ?? 'failed' : 'neither')]", "[unreadable(why ?? 'failed')]"],
  ['M48 reason: never baseline', DC, "fresh.pr ? 'baseline' : 'failed'", "'failed'"],
  ['M49 reason: dropped from the flag', DC, 'pr: 1, base: 0, reason })', 'pr: 1, base: 0 })'],
  ['M50 snapshot: fresh never set', DC, '          fresh[pane] = Boolean(snap && !baseline[pane])\n', '          const _f = Boolean(snap && !baseline[pane]); fresh[pane] = false\n          void _f\n'],
  ['M51 rebaseline: fresh not reset (expect equivalent)', DC, '{ settle(pane, reads[i].snap, run, at); fresh[pane] = false }', '{ settle(pane, reads[i].snap, run, at) }'],
  ['M52 settle: late wording not replaced', DC, 'if (errors.boot[pane]?.endsWith(LATE)) errors.boot[pane] =', 'if (false) errors.boot[pane] ='],
  ['M53 settle: late wording replaced without the time', DC, 'its baseline is the snapshot at ${new Date(at).toISOString()}', 'its baseline is a later snapshot'],
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
  if (only && !name.startsWith(only + ' ')) continue
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
