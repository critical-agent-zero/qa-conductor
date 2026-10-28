import json
F = 'public/harness.js'
T = ['test/harness.test.mjs']
m = [
    ('H1', "    if (firstRed.has(name)) return [0, firstRed.get(name)]", "    if (firstRed.has(name)) return [0, 0]"),
    ('H2', "    return [moved(c, view) ? 1 : amber.has(name) ? 2 : c && c.status !== 'same' ? 3 : 4, 0]", "    return [amber.has(name) ? 2 : c && c.status !== 'same' ? 3 : 4, 0]"),
    ('H3', "    return [moved(c, view) ? 1 : amber.has(name) ? 2 : c && c.status !== 'same' ? 3 : 4, 0]", "    return [moved(c, view) ? 1 : c && c.status !== 'same' ? 3 : 4, 0]"),
    ('H4', "    const covered = shownList.reduce((n, f) => n + (f.folded && num(f.collections) > 0 ? num(f.collections) : 1), 0)", "    const covered = shownList.length"),
    ('H5', "  const lateBaseline = ui.span === 'session' && Boolean(data.comparedAt)", "  const lateBaseline = false && Boolean(data.comparedAt)"),
    ('H6', "  const shared = b && b.base && b.pr ? b.base : data.baselineAt", "  const shared = data.baselineAt"),
    ('H7', "const unreadableText = reason => (typeof reason === 'string' && Object.hasOwn(UNREADABLE, reason) ? UNREADABLE[reason] : UNREADABLE.failed)", "const unreadableText = reason => (UNREADABLE[reason] || UNREADABLE.failed)"),
    ('H8', "  if (listing && listing.cut === true) out.push(", "  if (false) out.push("),
    ('H9', "  if (c.cut === true) out.push(node('p', 'dataErr', 'Cut short: the answer\\'s size limit stopped its lists.'))", ""),
    ('H10', "omittedIn(span, name) ? statusText({ omitted: true }) : statusText(c)]", "statusText(c)]"),
    ('H11', "${missing.length > 1 ? 'panes have' : 'pane has'} none", "pane has none"),
    ('H12', "      typeof f.collection === 'string' ? { act: `open:${f.collection}` } : undefined))", "      undefined))"),
    ('H13', "    if (listedIn(span, ui.view, ui.open)) out.push(", "    if (shown.includes(ui.open)) out.push("),
    ('H14', "  const seeded = Number.isSafeInteger(f.seeded) && f.seeded > 0 ? `, ${f.seeded} seeded` : ''", "  const seeded = ''"),
    ('H15', "  return num(n.inserted) + num(n.updated) + num(n.deleted) + num(n.fieldsDropped) + num(n.fieldsAdded) > 0 || c.keyLost === true", "  return num(n.inserted) + num(n.updated) + num(n.deleted) > 0"),
    ('H16', "    return changes > 0 || [counts.base, counts.pr].some(n => n && num(n.inserted) + num(n.updated) + num(n.deleted) > 0)", "    return changes > 0"),
    ('H17', "  const reason = lateBaseline ? 'baseline' : (flagsOf.find(", "  const reason = (flagsOf.find("),
    ('H18', "&& !(errs && errs.pr)", ""),
]
out = [{'id': i, 'file': F, 'old': o, 'new': n, 'tests': T} for (i, o, n) in m]
src = open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/' + F).read()
for x in out:
    if src.count(x['old']) != 1:
        print('miss', x['id'], src.count(x['old']))
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-37r4.json', 'w'), indent=1)
print(len(out))
