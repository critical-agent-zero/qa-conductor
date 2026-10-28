import json
P = 'lib/data-capture.mjs'
T = ['test/data-capture.test.mjs']
m = [
    ('V1', "const bytesOf = value => Buffer.byteLength(JSON.stringify(value))", "const bytesOf = value => JSON.stringify(value).length"),
    ('V2', "  if (red.has(name)) return [0, order.get(name)]", "  if (red.has(name)) return [0, 0]"),
    ('V3', "  if (red.has(name)) return [0, order.get(name)]", "  if (order.has(name)) return [0, order.get(name)]"),
    ('V4', "  return [moved ? 1 : order.has(name) ? 2 : changed ? 3 : 4, 0]", "  return [moved ? 1 : order.has(name) ? 2 : changed ? 4 : 4, 0]"),
    ('V5', "const byRank = (x, y) => x.rank[0] - y.rank[0] || x.rank[1] - y.rank[1] ||", "const byRank = (x, y) => x.rank[0] - y.rank[0] ||"),
    ('V6', "  for (let tier = 0; tier <= 4 && !stopped; tier++) {\n    for (const list of lists) {\n      while (!stopped && list.done < list.todo.length && list.todo[list.done].rank[0] === tier) {", "  for (let tier = 0; tier <= 0 && !stopped; tier++) {\n    for (const list of lists) {\n      while (!stopped && list.done < list.todo.length) {"),
    ('V7', "...(stopped && list.done < list.todo.length ? { cut: true } : {})", "...(false ? { cut: true } : {})"),
    ('V8', "    if (sessionMemo?.version !== version) {", "    if (true) {"),
    ('V9', "      if (!bootSpans.has(bootKey)) {", "      if (true) {"),
    ('V10', "    const bootKey = `${bootVersion} ${runs > 0} ${trust}`", "    const bootKey = `${bootVersion} ${runs > 0}`"),
    ('V11', "    bootVersion++\n    const at = now()", "    const at = now()"),
    ('V12', "[unreadable(why === 'baseline' ? 'baseline' : base ? why ?? 'failed' : 'neither')]", "[unreadable(base ? why ?? 'failed' : 'neither')]"),
    ('V13', "      const listedFlagsOut = listedFlags(flags, budget)\n      const out = listedLists(", "      const out = listedLists("),
    ('V14', "const divergenceMoved = c => c.changes.length > 0 || [c.counts.base, c.counts.pr].some(n => n.inserted + n.updated + n.deleted > 0)", "const divergenceMoved = c => c.changes.length > 0"),
    ('V15', "const rowsChanged = c => c.inserted.length + c.updated.length + c.deleted.length + c.fieldsDropped.length + c.fieldsAdded.length > 0 || c.keyLost", "const rowsChanged = c => c.inserted.length + c.updated.length + c.deleted.length > 0"),
    ('V16', "        if (f.severity === 'red') reds.add(f.collection)", "        reds.add(f.collection)"),
]
out = [{'id': i, 'file': P, 'old': o, 'new': n, 'tests': T} for (i, o, n) in m]
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-36r4.json', 'w'), indent=1)
print(len(out))
