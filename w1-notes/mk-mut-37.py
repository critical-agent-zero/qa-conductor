import json
P = 'public/harness.js'
T = ['test/harness.test.mjs']
m = [
    ('H1', "    if (!span) return name === 'session' && data.comparedAt ? 1 : 0", "    if (!span) return 0"),
    ('H2', "    if (ui.span === 'session' && data.comparedAt) {", "    if (false) {"),
    ('H3', "  const rank = name => (red.has(name) ? 0 : collections[name] && collections[name].status !== 'same' ? 1 : 2)", "  const rank = name => 0"),
    ('H4', "  const rank = name => (red.has(name) ? 0 : collections[name] && collections[name].status !== 'same' ? 1 : 2)", "  const rank = name => (collections[name] && collections[name].status !== 'same' ? 1 : 2)"),
    ('H5', "  return d && Number.isSafeInteger(d.collectionsCount) ? Math.max(d.collectionsCount, listed) : listed", "  return listed"),
    ('H6', "    const more = Number.isSafeInteger(total) ? total - fields.length : 0", "    const more = 0"),
    ('H7', "${ui.span === 'session' ? 'Re-baseline to compare both from one moment.' : 'The boot span stays as it was: a Re-baseline aligns only the session span.'}", "Re-baseline to compare both from one moment."),
    ('H8', "      out.push(node('p', 'dataErr', reason === 'baseline'", "      out.push(node('p', 'dataErr', false"),
    ('H9', "  if (f.kind === 'unreadable') return UNREADABLE[f.reason] || UNREADABLE.failed", "  if (f.kind === 'unreadable') return UNREADABLE.failed"),
    ('H10', "  if (f.collection === null && f.kind === 'unverified') {", "  if (false) {"),
    ('H11', "    return f.folded\n", "    return false\n"),
    ('H12', "  if (span.unlisted) {\n    out.push(node('p', 'dataErr',", "  if (false) {\n    out.push(node('p', 'dataErr',"),
    ('H13', "  if (span.unlisted) return out", ""),
    ('H14', "const statusText = c => (c && c.omitted ? 'unknown (left out of a snapshot)' : label(STATUS_LABELS, c && c.status))", "const statusText = c => label(STATUS_LABELS, c && c.status)"),
    ('H15', "const countText = n => (Number.isSafeInteger(n) ? String(n) : '?')", "const countText = n => String(n)"),
    ('H16', "    for (const problem of problems.slice(0, SHOWN_PROBLEMS)) out.push(", "    for (const problem of problems) out.push("),
    ('H17', "    if (more > 0) out.push(node('p', 'stepSub', `${paneName(pane)}: and ${more} more problems`))", ""),
    ('H18', "    if (total > shownFlags) items.push(", "    if (total >= shownFlags) items.push("),
    ('H19', "  .replace(/(\\[text with a secret-looking key, \\d+ characters), [0-9a-f]{0,8}$/, '$1')", "  .replace(/(\\[text with a secret-looking key, \\d+ characters), [0-9a-f]{0,7}$/, '$1')"),
    ('H20', "  if (b && b.base && b.pr && b.base !== b.pr) return", "  if (b && b.base && b.pr) return"),
]
out = [{'id': i, 'file': P, 'old': o, 'new': n, 'tests': T} for (i, o, n) in m]
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-37.json', 'w'), indent=1)
print(len(out))
