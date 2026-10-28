import json
C = 'lib/data-capture.mjs'
CT = ['test/data-capture.test.mjs']
DIV = "      if (size > budget.left) break\n      budget.left -= size\n      const { out, cut } = within(changes, LISTED, budget)"
m = [
    # the review's survivors, re-made for this code
    ('M11 fallback: amber flags too', C, "...flags.filter(f => f.severity === 'red').slice(0, FALLBACK_FLAGS)", '...flags.slice(0, FALLBACK_FLAGS)', CT),
    ('M24 rowsChanged: keyLost ignored', C, 'c.fieldsAdded.length > 0 || c.keyLost', 'c.fieldsAdded.length > 0', CT),
    ('N4 divergence: entry not subtracted', C, DIV, "      if (size > budget.left) break\n      const { out, cut } = within(changes, LISTED, budget)", CT),
    ('N7 divergence: skip, not stop', C, DIV, "      if (size > budget.left) { list.done++; continue }\n      budget.left -= size\n      const { out, cut } = within(changes, LISTED, budget)", CT),
    ('N12 byRank: name order reversed', C, '(x.name < y.name ? -1 : x.name > y.name ? 1 : 0)', '(x.name < y.name ? 1 : x.name > y.name ? -1 : 0)', CT),
    ('N15a rank: own amber not ranked', C, 'moved ? 4 : order.has(name) ? 5 :', 'moved ? 4 : false ? 5 :', CT),
    ('N15b rank: seeded amber not ranked', C, '    if (order.has(name)) return [2, order.get(name)]\n', '', CT),
    ('N23 cut: whenever another stopped', C, '...(list.done < list.todo.length ? { cut: true } : {})', "...(lists.some(l => l.done < l.todo.length) ? { cut: true } : {})", CT),
    # this round's code
    ('R1 queue: each list whole, in turn', C, '.sort((x, y) => byRank(x.item, y.item) || x.at - y.at)', '.sort((x, y) => x.at - y.at || byRank(x.item, y.item))', CT),
    ('R2 queue: by tier only', C, '.sort((x, y) => byRank(x.item, y.item) || x.at - y.at)', '.sort((x, y) => x.item.rank[0] - y.item.rank[0] || x.at - y.at)', CT),
    ('R3 own: no base snapshot', C, '      const known = latest.base ?? baseline.base ?? seeded.base\n', '      const known = null\n', CT),
    ('R4 own: no boot.pr fallback', C, "      if (boot.pr) return name => Object.hasOwn(boot.pr.collections, name) && boot.pr.collections[name].status === 'added'\n", '', CT),
    ('R5 own: everything own without a base diff', C, '      if (base) return name => !Object.hasOwn(base.collections, name)\n', '      if (base) return name => !Object.hasOwn(base.collections, name)\n      return () => true\n', CT),
    ('R6 flags: amber after every red', C, '  return within(out, LISTED_FLAGS, budget).out', "  return within([...out.filter(f => f.severity === 'red'), ...out.filter(f => f.severity !== 'red')], LISTED_FLAGS, budget).out", CT),
    ('R7 answer order: owned ignored', C, 'owned(a) - owned(b) || sev(a)', 'sev(a)', CT),
    ('R8 answer order: key-lost with row-losing', C, "f.kind === 'key-lost' ? 1 : 2", "f.kind === 'key-lost' ? 0 : 2", CT),
    ('R9 answer order: no groups', C, '|| group(a) - group(b) ', '', CT),
    ('R10 answer order: leftOut not row-losing', C, "(ROW_LOSING.has(f.kind) || leftOut(f) ? 0 :", "(ROW_LOSING.has(f.kind) ? 0 :", CT),
    ('R11 takeAll: mask as each read lands', C, '    const raws = await Promise.all(panes.map(pane => read(pane, phase, signal)))\n    return raws.map(masked)', '    return Promise.all(panes.map(pane => take(pane, phase, signal)))', CT),
    ('R12 reason: base diff, not the base read', C, "baseRead ? why ?? 'failed' : 'neither'", "base ? why ?? 'failed' : 'neither'", CT),
    ('R13 reason: session passes no fresh base', C, "Boolean(session.base) || fresh.base)", "Boolean(session.base))", CT),
    ('R14 flags: seeded amber dropped', C, "    if (f.severity === 'red' && f.kind === 'unverified'", "    if (f.severity !== 'red') continue\n    if (f.kind === 'unverified'", CT),
]
json.dump([{'id': i, 'file': f, 'old': o, 'new': n, 'tests': t} for i, f, o, n, t in m],
          open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-36r5.json', 'w'), indent=1)
print(len(m))
