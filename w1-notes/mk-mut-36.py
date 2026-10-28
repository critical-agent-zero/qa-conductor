import json
P = 'lib/data-capture.mjs'
T = ['test/data-capture.test.mjs']
m = [
    # M1: entries charged, listing stops, fallback
    ('Q1', "    const size = entrySize(name, rest)\n    if (size > budget.left) { stopped = true; break }\n    budget.left -= size\n    let cut = false", "    let cut = false"),
    ('Q2', "  return { collections, collectionsCount: Object.keys(diff.collections).length, ...(stopped ? { cut: true } : {}) }", "  return { collections, collectionsCount: Object.keys(diff.collections).length }"),
    ('Q3', "    const { changes, ...rest } = div.collections[name]\n    const size = entrySize(name, rest)\n    if (size > budget.left) { stopped = true; break }\n    budget.left -= size\n", "    const { changes, ...rest } = div.collections[name]\n"),
    ('Q4', """      } catch {
        try {
          cached = { id, json: JSON.stringify(view({ isolation }, { lists: false })) }
        } catch (error) {
          cached = { id, error }
        }
      }""", """      } catch (error) {
        cached = { id, error }
      }"""),
    ('Q5', "flags: [unlisted(), ...flags.filter(f => f.severity === 'red').slice(0, FALLBACK_FLAGS)], flagsCount: { red: red + 1,", "flags: [unlisted(), ...flags.filter(f => f.severity === 'red').slice(0, FALLBACK_FLAGS)], flagsCount: { red,"),
    ('Q6', "flags: [unlisted(), ...flags.filter(f => f.severity === 'red').slice(0, FALLBACK_FLAGS)]", "flags: [unlisted()]"),
    ('Q7', "  return text.length > ERROR_TEXT ? `${text.slice(0, ERROR_TEXT)}…` : text", "  return text"),
    ('Q8', "const listedProblems = problems => problems.slice(0, LISTED_PROBLEMS)", "const listedProblems = problems => problems"),
    # M2: ranking, fold
    ('R1', "const rankOf = (flagged, name, moved, changed) => (flagged.get(name) === 'red' ? 0 : moved ? 1 : flagged.has(name) ? 2 : changed ? 3 : 4)", "const rankOf = (flagged, name, moved, changed) => (moved ? 1 : changed ? 3 : 4)"),
    ('R2', "const rankOf = (flagged, name, moved, changed) => (flagged.get(name) === 'red' ? 0 : moved ? 1 : flagged.has(name) ? 2 : changed ? 3 : 4)", "const rankOf = (flagged, name, moved, changed) => (flagged.has(name) ? 0 : moved ? 1 : changed ? 3 : 4)"),
    ('R3', "    if (f.kind === 'unverified' && f.collection !== null && ++named > LISTED_UNVERIFIED) {", "    if (false) {"),
    ('R4', "  if (rest.length) out.splice(foldAt, 0,", "  if (rest.length) out.push("),
    ('R5', "names: rest.slice(0, 5), folded: true })", "names: rest.slice(0, 4), folded: true })"),
    ('R6', "      const prOut = listed(pr, budget, flagged)\n      const divOut = base && pr ? listedDivergence(divergence(base, pr), budget, flagged) : null\n      const baseOut = listed(base, budget, flagged)", "      const baseOut = listed(base, budget, flagged)\n      const prOut = listed(pr, budget, flagged)\n      const divOut = base && pr ? listedDivergence(divergence(base, pr), budget, flagged) : null"),
    # lows
    ('S1', "    const bootAligned = !(boot.base && boot.pr) || (bootRun.base === readyRun && bootRun.pr === readyRun)", "    const bootAligned = both(boot, bootRun)"),
    ('S2', "    if (reads.some(r => r.snap)) baselineAt = at\n", "    baselineAt = at\n"),
    ('S3', "      if (!base && !pr && why === null) return null", "      if (!base && !pr) return null"),
    ('S4', "      boot: span(boot.base, boot.pr, bootAligned, runs > 0 ? 'failed' : null),", "      boot: span(boot.base, boot.pr, bootAligned, null),"),
    ('S5', "[unreadable(base ? why ?? 'failed' : 'neither')]", "[unreadable(base ? 'failed' : 'neither')]"),
    ('S6', "[unreadable(base ? why ?? 'failed' : 'neither')]", "[unreadable(why ?? 'failed')]"),
    ('S7', "          fresh[pane] = Boolean(snap && !baseline[pane])\n", "          fresh[pane] = false\n"),
    ('S8', "    if (errors.boot[pane]?.endsWith(LATE)) errors.boot[pane] =", "    if (false) errors.boot[pane] ="),
    # round-3 survivors
    ('U1', "    const { out, cut } = within(changes, LISTED, budget)", "    const { out, cut } = within(changes, Infinity, budget)"),
    ('U2', "changes: out, changesCount: changes.length,", "changes: out, changesCount: out.length,"),
    ('U3', "changes: out, changesCount: changes.length, ...(cut ? { cut: true } : {}) })", "changes: out, changesCount: changes.length })"),
    ('U4', "    const { out, cut } = within(changes, LISTED, budget)", "    const { out, cut } = within(changes, LISTED, { left: Infinity })"),
    ('U5', "  return within([...out, ...flags.filter(f => f.severity !== 'red')], LISTED_FLAGS, budget).out", "  return within([...out, ...flags.filter(f => f.severity !== 'red')], LISTED_FLAGS, { left: Infinity }).out"),
    ('U6', "      const budget = { left: Math.floor(viewBytes / 2) }", "      const budget = { left: viewBytes }"),
    ('U7', "          panes.forEach((pane, i) => { settle(pane, reads[i].snap, run, at); fresh[pane] = false })", "          panes.forEach((pane, i) => { settle(pane, reads[i].snap, run - 1, at); fresh[pane] = false })"),
]
out = [{'id': i, 'file': P, 'old': o, 'new': n, 'tests': T} for (i, o, n) in m]
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-36.json', 'w'), indent=1)
print(len(out))
