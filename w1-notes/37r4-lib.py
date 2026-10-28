R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('public/harness.js', [
    # the shared baseline time
    ("""function baselineText(data) {
  const b = data.baselines
  if (b && b.base && b.pr && b.base !== b.pr) return `baselines BASE ${clockTime(b.base)}, PR ${clockTime(b.pr)}`
  return `baseline ${data.baselineAt ? clockTime(data.baselineAt) : '—'}`
}""",
     """// The panes' baseline times: one when they share it (from the ready read,
// or a snapshot both took as their baseline), else each pane's.
function baselineText(data) {
  const b = data.baselines
  if (b && b.base && b.pr && b.base !== b.pr) return `baselines BASE ${clockTime(b.base)}, PR ${clockTime(b.pr)}`
  const shared = b && b.base && b.pr ? b.base : data.baselineAt
  return `baseline ${shared ? clockTime(shared) : '—'}`
}"""),
    # UNREADABLE lookup
    ("""function flagText(f) {
  if (f.kind === 'unreadable') return UNREADABLE[f.reason] || UNREADABLE.failed
  if (f.kind === 'unlisted') return 'This span\\'s details were too big to list: only its counts and first red flags are shown.'""",
     """const unreadableText = reason => (typeof reason === 'string' && Object.hasOwn(UNREADABLE, reason) ? UNREADABLE[reason] : UNREADABLE.failed)

function flagText(f) {
  if (f.kind === 'unreadable') return unreadableText(f.reason)
  if (f.kind === 'unlisted') return 'This span\\'s details were too big to list: only its first red flags are shown, with how many flags it has in all.'"""),
    # column-dropped's count and fields
    ("""  const field = f.field === undefined ? '' : ` (${isolated(f.field)})`
  return `${isolated(f.collection)}: ${label(KIND_LABELS, f.kind)}${field}, PR ${f.pr}, base ${f.base}${f.shared ? ', the base\\'s too' : ''}`""",
     """  const field = f.field === undefined ? '' : ` (${isolated(f.field)})`
  // a collection's dropped columns, one flag: how many, and the first few
  const columns = f.kind === 'column-dropped' && Number.isSafeInteger(f.count)
    ? ` (${f.count}${Array.isArray(f.fields) && f.fields.length ? `: ${f.fields.map(isolated).join(', ')}${f.count > f.fields.length ? ', …' : ''}` : ''})`
    : ''
  return `${isolated(f.collection)}: ${label(KIND_LABELS, f.kind)}${field}${columns}, PR ${f.pr}, base ${f.base}${f.shared ? ', the base\\'s too' : ''}`"""),
    # spanCollections by the engine's order
    ("""// The collections a span's view lists: those with a red flag first, then
// any that changed or are unknown, then the rest, each in name order. So
// padding a PR names to sort first can't push a changed one out of those
// drawn.
function spanCollections(span, view) {
  const d = view === 'divergence' ? span.divergence : span[view]
  const collections = d && d.collections ? d.collections : {}
  const red = new Set((span.flags || []).filter(f => f.severity === 'red' && f.collection !== null).map(f => f.collection))
  const rank = name => (red.has(name) ? 0 : collections[name] && collections[name].status !== 'same' ? 1 : 2)
  return Object.keys(collections).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
}""",
     """// The collections a span's view lists, as the data answer ranks them:
// those with a red flag first, in the order of their first red flag in the
// engine's order (so the base pane's collections, and what lost data, come
// before the PR's own and its padding); then those whose rows moved; then
// those with an amber flag; then any other change; then the rest; each in
// name order. So padding a PR adds, flagged or not, can't push a changed
// one out of those drawn.
const num = v => (Number.isSafeInteger(v) && v > 0 ? v : 0)
const moved = (c, view) => {
  if (!c || typeof c !== 'object') return false
  if (view === 'divergence') {
    const changes = Number.isSafeInteger(c.changesCount) ? c.changesCount : Array.isArray(c.changes) ? c.changes.length : 0
    const counts = c.counts || {}
    return changes > 0 || [counts.base, counts.pr].some(n => n && num(n.inserted) + num(n.updated) + num(n.deleted) > 0)
  }
  const n = c.counts || {}
  return num(n.inserted) + num(n.updated) + num(n.deleted) + num(n.fieldsDropped) + num(n.fieldsAdded) > 0 || c.keyLost === true
}
function spanCollections(span, view) {
  const d = view === 'divergence' ? span.divergence : span[view]
  const collections = d && d.collections ? d.collections : {}
  const firstRed = new Map()
  const amber = new Set()
  ;(span.flags || []).forEach((f, i) => {
    if (!f || typeof f.collection !== 'string') return
    if (f.severity === 'red') { if (!firstRed.has(f.collection)) firstRed.set(f.collection, i) } else amber.add(f.collection)
  })
  const rank = name => {
    if (firstRed.has(name)) return [0, firstRed.get(name)]
    const c = collections[name]
    return [moved(c, view) ? 1 : amber.has(name) ? 2 : c && c.status !== 'same' ? 3 : 4, 0]
  }
  const ranked = Object.keys(collections).map(name => [rank(name), name])
  ranked.sort(([x, a], [y, b]) => x[0] - y[0] || x[1] - y[1] || (a < b ? -1 : a > b ? 1 : 0))
  return ranked.map(([, name]) => name)
}
// A diff's or divergence's collections, as an own property only.
const listedIn = (span, view, name) => {
  const d = view === 'divergence' ? span.divergence : span[view]
  return Boolean(d && d.collections && typeof name === 'string' && Object.hasOwn(d.collections, name))
}
// Whether a pane's snapshot may have left a collection out: the divergence
// entry doesn't say, its panes' diffs do.
const omittedIn = (span, name) => ['base', 'pr'].some(pane => listedIn(span, pane, name) && Boolean(span[pane].collections[name].omitted))"""),
    # the panel: ui.open by name
    ("""// The Data panel. ui: { span: 'session'|'boot', view: 'divergence'|'base'|'pr',
// open: the index of the collection shown in full, or null }.""",
     """// The Data panel. ui: { span: 'session'|'boot', view: 'divergence'|'base'|'pr',
// open: the name of the collection shown in full, or null }: by name, so
// the next answer keeps it open wherever it now ranks."""),
    # late baseline, keyed on the data
    ("""  const span = data[ui.span]
  if (!span) {
    // before any snapshot; after one, a span with nothing at all is unknown
    if (ui.span === 'session' && data.comparedAt) {
      out.push(node('ul', 'flags', undefined, { children: [node('li', 'flag red', UNREADABLE.neither)] }))
      return out
    }""",
     """  const span = data[ui.span]
  // the session span's PR baseline is the latest snapshot itself, which
  // read the PR pane: whatever the flag's reason says, its changes are
  // unknown only because there is nothing yet to compare it with
  const errs = data.errors && data.errors.session
  const lateBaseline = ui.span === 'session' && Boolean(data.comparedAt) && Boolean(data.baselines && data.baselines.pr === data.comparedAt) && !(errs && errs.pr)
  if (!span) {
    // before any snapshot; after one, a span with nothing at all is unknown
    if (ui.span === 'session' && data.comparedAt) {
      out.push(node('ul', 'flags', undefined, { children: [node('li', 'flag red', lateBaseline ? UNREADABLE.baseline : UNREADABLE.neither)] }))
      return out
    }"""),
    ("""  const flagsOf = span.flags || []
  const reason = (flagsOf.find(f => f.kind === 'unreadable') || {}).reason
  // why a span is incomplete, per pane: a base pane missing excuses
  // nothing; a PR pane missing leaves its changes unknown; windows that
  // differ excuse nothing; an answer too big lists nothing
  const missing = ['base', 'pr'].filter(pane => !span[pane])
  if (span.unlisted) {
    out.push(node('p', 'dataErr', 'This span\\'s details were too big to list: its counts and first red flags are below, and nothing else.'))
  } else {""",
     """  const flagsOf = span.flags || []
  const reason = lateBaseline ? 'baseline' : (flagsOf.find(f => f.kind === 'unreadable') || {}).reason
  // why a span is incomplete, per pane: a base pane missing excuses
  // nothing; a PR pane missing leaves its changes unknown; windows that
  // differ excuse nothing. An answer too big to list says so in its flag.
  const missing = ['base', 'pr'].filter(pane => !span[pane])
  if (!span.unlisted) {"""),
    ("""    const items = flags.slice(0, SHOWN_FLAGS).map(f => node('li', `flag ${f.severity === 'red' ? 'red' : 'amber'}`, flagText(f)))
    if (!span.pr && !span.unlisted && !flags.some(f => f.kind === 'unreadable')) items.unshift(node('li', 'flag red', flagText({ kind: 'unreadable' })))
    const shownFlags = items.length
    if (total > shownFlags) items.push(node('li', 'stepSub', `and ${total - shownFlags} more flags`))""",
     """    const shownList = flags.slice(0, SHOWN_FLAGS)
    // a flag on a collection opens it, by name
    const items = shownList.map(f => node('li', `flag ${f.severity === 'red' ? 'red' : 'amber'}`, f.kind === 'unreadable' ? unreadableText(reason) : flagText(f),
      typeof f.collection === 'string' ? { act: `open:${f.collection}` } : undefined))
    if (!span.pr && !span.unlisted && !flags.some(f => f.kind === 'unreadable')) items.unshift(node('li', 'flag red', unreadableText(reason)))
    // a folded flag stands for as many flags as it has collections
    const covered = shownList.reduce((n, f) => n + (f.folded && num(f.collections) > 0 ? num(f.collections) : 1), 0)
    if (total > covered) items.push(node('li', 'stepSub', `and ${total - covered} more flags`))"""),
    ("""    out.push(node('p', 'stepSub', `No divergence: it needs both panes' data, and the ${missing.map(paneName).join(' and ')} pane has none for this span.`))""",
     """    out.push(node('p', 'stepSub', `No divergence: it needs both panes' data, and the ${missing.map(paneName).join(' and ')} ${missing.length > 1 ? 'panes have' : 'pane has'} none for this span.`))"""),
    ("""      return [isolated(name), deltaText(c.counts.base), deltaText(c.counts.pr), statusText(c)]""",
     """      return [isolated(name), deltaText(c.counts.base), deltaText(c.counts.pr), omittedIn(span, name) ? statusText({ omitted: true }) : statusText(c)]"""),
    ("""      ...shown.map((name, i) => node('tr', ui.open === i ? 'on' : undefined, undefined, {
        act: `open:${i}`, children: rowsOf(name).map(text => node('td', undefined, text)),
      })),
    ],
  }))
  const all = collectionsTotal(span, ui.view)
  if (all > shown.length) out.push(node('p', 'stepSub', `and ${all - shown.length} more collections`))
  if (ui.open !== null && ui.open !== undefined && shown[ui.open] !== undefined) out.push(...collectionNodes(span, ui.view, shown[ui.open]))
  return out""",
     """      ...shown.map(name => node('tr', ui.open === name ? 'on' : undefined, undefined, {
        act: `open:${name}`, children: rowsOf(name).map(text => node('td', undefined, text)),
      })),
    ],
  }))
  const all = collectionsTotal(span, ui.view)
  if (all > shown.length) out.push(node('p', 'stepSub', `and ${all - shown.length} more collections`))
  // a list the answer's size cut short says so
  const listing = ui.view === 'divergence' ? span.divergence : pane
  if (listing && listing.cut === true) out.push(node('p', 'dataErr', 'Cut short: the answer\\'s size limit stopped this list, so some collections aren\\'t listed.'))
  // the collection opened, by name: shown wherever it ranks now, if this
  // view lists it
  if (typeof ui.open === 'string') {
    if (listedIn(span, ui.view, ui.open)) out.push(...collectionNodes(span, ui.view, ui.open))
    else out.push(node('p', 'stepSub', `${isolated(ui.open)} isn't listed in this view.`))
  }
  return out"""),
    # collectionNodes: a collection's own cut
    ("""  if (c.truncated) out.push(node('p', 'stepSub', 'Truncated: only its count is compared.'))""",
     """  if (c.truncated) out.push(node('p', 'stepSub', 'Truncated: only its count is compared.'))
  if (c.cut === true) out.push(node('p', 'dataErr', 'Cut short: the answer\\'s size limit stopped its lists.'))"""),
    # the click handler: values may hold ':'
    ("""    const [group, value] = act.split(':')
    if (group === 'span' || group === 'view') { D.ui[group] = value; D.ui.open = null }
    else if (group === 'open') D.ui.open = D.ui.open === +value ? null : +value""",
     """    const at = act.indexOf(':')
    const group = act.slice(0, at)
    const value = act.slice(at + 1)
    if (group === 'span' || group === 'view') { D.ui[group] = value; D.ui.open = null }
    else if (group === 'open') D.ui.open = D.ui.open === value ? null : value"""),
])
print('ok')
