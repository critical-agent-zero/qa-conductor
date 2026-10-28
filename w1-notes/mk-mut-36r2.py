import json
C = 'lib/data-capture.mjs'
S = 'lib/server.mjs'
CT = ['test/data-capture.test.mjs']
ST = ['test/server.test.mjs']
m = [
    ('S1 trust ignores windows', C, "{ trusted: trust === 'trusted' && aligned }", "{ trusted: trust === 'trusted' }", CT),
    ('S2 complete ignores windows', C, "complete: Boolean(base && pr) && aligned,", "complete: Boolean(base && pr),", CT),
    ('S3 boot run not kept', C, "      bootRun[pane] = run\n", "", CT),
    ('S4 session by boot runs', C, "both(session, baseRun)", "both(session, bootRun)", CT),
    ('S5 no unreadable', C, ": [unreadable()]", ": []", CT),
    ('S6 one budget', C, "    const span = (base, pr, aligned) => {\n      if (!base && !pr) return null\n      // each span its own share of the budget\n      const budget = { left: Math.floor(viewBytes / 2) }\n", "    const budget = { left: viewBytes }\n    const span = (base, pr, aligned) => {\n      if (!base && !pr) return null\n", CT),
    ('S7 fields whole', C, "      fieldsDropped: part(c.fieldsDropped), fieldsAdded: part(c.fieldsAdded),\n", "", CT),
    ('S8 flags whole', C, "flags: listedFlags(flags, budget),", "flags,", CT),
    ('S9 amber not counted', C, "amber: flags.length - red", "amber: 0", CT),
    ('S10 collections whole', C, "  if (names.length <= LISTED_COLLECTIONS) return names", "  return names", CT),
    ('S11 no cut marker', C, "    if (cut) value.cut = true\n", "", CT),
    ('S12 failure not cached', C, "        cached = { id, error }", "        cached = null; throw error", CT),
    ('S13 errors overwritten', C, "errors.boot[pane] = errors.boot[pane] ? `${errors.boot[pane]}; ${why}` : why", "errors.boot[pane] = why", CT),
    ('S14 promise without S0', C, "const why = seeded[pane] ?", "const why = true ?", CT),
    ('S15 failed close untracked', S, "closingBoots.add(capture.close().catch(() => {}))", "capture.close().catch(() => {})", ST),
    ('S16 settling ignored', S, "...ending.map(c => c.close().catch(() => {})), ...settling]", "...ending.map(c => c.close().catch(() => {}))]", ST),
    ('S17 flags unsorted', C, "  return within([...red, ...flags.filter(f => f.severity !== 'red')], LISTED_FLAGS, budget).out", "  return within(flags, LISTED_FLAGS, budget).out", CT),
    ('S18 late settle run 0', C, "if (snap && !baseline[pane]) { settle(pane, snap, run, at); latest[pane] = null }", "if (snap && !baseline[pane]) { settle(pane, snap, 1, at); latest[pane] = null }", CT),
    ('S19 changed not first', C, "  const keep = new Set([...names.filter(name => changed(collections[name])), ...names].slice(0, LISTED_COLLECTIONS))", "  const keep = new Set(names.slice(0, LISTED_COLLECTIONS))", CT),
    ('S20 baselines missing', C, "      baselines: { ...baseAt },\n", "", CT),
]
json.dump([{'id': i, 'file': f, 'old': o, 'new': n, 'tests': t} for i, f, o, n, t in m],
          open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-36r2.json', 'w'), indent=1)
print(len(m))
