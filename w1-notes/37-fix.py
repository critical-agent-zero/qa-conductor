p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/public/harness.js'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""const SHOWN_FLAGS = 100
const SHOWN_ACTIONS = 100""", """const SHOWN_FLAGS = 100
const SHOWN_PROBLEMS = 20
const SHOWN_ACTIONS = 100""")

sub("""const STATUS_LABELS = new Map([
  ['same', 'same'], ['both', 'both'], ['pr-only', 'PR only'], ['base-only', 'base only'], ['differs', 'differs'],
  ['unknown', 'unknown (truncated)'], ['changed', 'changed'], ['added', 'added'],
])
const label = (map, key) => map.get(key) || isolated(key)

function flagText(f) {
  if (f.kind === 'unreadable') return 'The PR pane couldn\\'t be read for this span, so its changes are unknown.'
  const field = f.field === undefined ? '' : ` (${isolated(f.field)})`
  return `${isolated(f.collection)}: ${label(KIND_LABELS, f.kind)}${field}, PR ${f.pr}, base ${f.base}${f.shared ? ', the base\\'s too' : ''}`
}""", """const STATUS_LABELS = new Map([
  ['same', 'same'], ['both', 'both'], ['pr-only', 'PR only'], ['base-only', 'base only'], ['differs', 'differs'],
  ['unknown', 'unknown (truncated)'], ['changed', 'changed'], ['added', 'added'], ['dropped', 'dropped'],
])
const label = (map, key) => map.get(key) || isolated(key)
// A collection a pane's snapshot may have left out says so.
const statusText = c => (c && c.omitted ? 'unknown (left out of a snapshot)' : label(STATUS_LABELS, c && c.status))
const countText = n => (Number.isSafeInteger(n) ? String(n) : '?')

// Why a span's PR pane has no diff (the unreadable flag's reason).
const UNREADABLE = {
  failed: 'The PR pane couldn\\'t be read for this span, so its changes are unknown.',
  neither: 'Neither pane could be read for this span, so the PR pane\\'s changes are unknown.',
  baseline: 'The PR pane\\'s baseline is this snapshot: take another to see its changes.',
}
const namesText = f => (Array.isArray(f.names) && f.names.length ? `, such as ${f.names.map(isolated).join(', ')}` : '')

function flagText(f) {
  if (f.kind === 'unreadable') return UNREADABLE[f.reason] || UNREADABLE.failed
  if (f.kind === 'unlisted') return 'This span\\'s details were too big to list: only its counts and first red flags are shown.'
  // one flag for many collections: those only the PR pane has, or those
  // past the ones listed one by one
  if (f.collection === null && f.kind === 'unverified') {
    const n = Number.isSafeInteger(f.collections) ? f.collections : '?'
    return f.folded
      ? `${n} more collections: ${label(KIND_LABELS, f.kind)}${namesText(f)}`
      : `${n} collections only the PR pane has: ${label(KIND_LABELS, f.kind)}${namesText(f)}`
  }
  const field = f.field === undefined ? '' : ` (${isolated(f.field)})`
  return `${isolated(f.collection)}: ${label(KIND_LABELS, f.kind)}${field}, PR ${f.pr}, base ${f.base}${f.shared ? ', the base\\'s too' : ''}`
}""")

sub("""function dataBadge(data) {
  if (!data || !data.active || data.closed) return 0
  const redOf = span => {
    if (!span) return 0""", """function dataBadge(data) {
  if (!data || !data.active || data.closed) return 0
  const redOf = (span, name) => {
    // after a snapshot, a span with nothing at all: unknown, red
    if (!span) return name === 'session' && data.comparedAt ? 1 : 0""")
sub("""  return redOf(data.boot) + redOf(data.session)
}""", """  return redOf(data.boot, 'boot') + redOf(data.session, 'session')
}""")

sub("""// The collections a span's view lists, in name order.
function spanCollections(span, view) {
  const of = d => (d && d.collections ? Object.keys(d.collections) : [])
  const names = view === 'divergence' ? of(span.divergence) : of(span[view])
  return names.sort()
}""", """// The collections a span's view lists: those with a red flag first, then
// any that changed or are unknown, then the rest, each in name order. So
// padding a PR names to sort first can't push a changed one out of those
// drawn.
function spanCollections(span, view) {
  const d = view === 'divergence' ? span.divergence : span[view]
  const collections = d && d.collections ? d.collections : {}
  const red = new Set((span.flags || []).filter(f => f.severity === 'red' && f.collection !== null).map(f => f.collection))
  const rank = name => (red.has(name) ? 0 : collections[name] && collections[name].status !== 'same' ? 1 : 2)
  return Object.keys(collections).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
}
// How many collections a span's view has in all: its own count, or those
// it lists.
function collectionsTotal(span, view) {
  const d = view === 'divergence' ? span.divergence : span[view]
  const listed = d && d.collections ? Object.keys(d.collections).length : 0
  return d && Number.isSafeInteger(d.collectionsCount) ? Math.max(d.collectionsCount, listed) : listed
}""")

sub("""    if (session && spanName === 'session') out.push(node('p', 'dataErr', `${paneName(pane)}: ${isolated(session)}`))
    for (const problem of (data.problems && data.problems[pane]) || []) out.push(node('p', 'stepSub', `${paneName(pane)}: ${isolated(problem)}`))
  }
  return out
}""", """    if (session && spanName === 'session') out.push(node('p', 'dataErr', `${paneName(pane)}: ${isolated(session)}`))
    const problems = (data.problems && data.problems[pane]) || []
    for (const problem of problems.slice(0, SHOWN_PROBLEMS)) out.push(node('p', 'stepSub', `${paneName(pane)}: ${isolated(problem)}`))
    const counted = data.problemsCount && Number.isSafeInteger(data.problemsCount[pane]) ? data.problemsCount[pane] : problems.length
    const more = Math.max(counted, problems.length) - Math.min(problems.length, SHOWN_PROBLEMS)
    if (more > 0) out.push(node('p', 'stepSub', `${paneName(pane)}: and ${more} more problems`))
  }
  return out
}""")

sub("""  const span = data[ui.span]
  if (!span) {
    out.push(node('p', 'stepSub', ui.span === 'session' ? 'Nothing to compare yet: take a snapshot with Snapshot now.' : 'No boot span: neither pane has a seeded and a ready snapshot.'))
    return out
  }
  // why a span is incomplete, per pane: a base pane missing excuses
  // nothing; a PR pane missing leaves its changes unknown; windows that
  // differ excuse nothing
  const missing = ['base', 'pr'].filter(pane => !span[pane])
  if (!span.base) out.push(node('p', 'dataErr', 'Incomplete: the BASE pane has no data for this span, so nothing it did can excuse a change.'))
  if (!span.pr) out.push(node('p', 'dataErr', 'Incomplete: the PR pane has no data for this span, so its changes are unknown.'))
  if (span.aligned === false) {
    out.push(node('p', 'dataErr', 'Incomplete: the panes\\' windows differ (a pane\\'s ready read failed, and a later snapshot is its baseline), so nothing in the base pane can excuse a change. Re-baseline to compare both from one moment.'))
  }
  // the flags, red first, at most SHOWN_FLAGS, and how many more there are
  const flags = [...span.flags].sort((a, b) => (a.severity === 'red' ? 0 : 1) - (b.severity === 'red' ? 0 : 1))
  const total = Math.max(flagTotal(span), flags.length)
  if (total || !span.pr) {
    const items = flags.slice(0, SHOWN_FLAGS).map(f => node('li', `flag ${f.severity === 'red' ? 'red' : 'amber'}`, flagText(f)))
    if (!span.pr && !flags.some(f => f.kind === 'unreadable')) items.unshift(node('li', 'flag red', flagText({ kind: 'unreadable' })))
    if (total > items.length) items.push(node('li', 'stepSub', `and ${total - items.length} more flags`))
    out.push(node('ul', 'flags', undefined, { children: items }))
  } else out.push(node('p', 'stepSub', 'No destructive change.'))""", """  const span = data[ui.span]
  if (!span) {
    // before any snapshot; after one, a span with nothing at all is unknown
    if (ui.span === 'session' && data.comparedAt) {
      out.push(node('ul', 'flags', undefined, { children: [node('li', 'flag red', UNREADABLE.neither)] }))
      return out
    }
    out.push(node('p', 'stepSub', ui.span === 'session' ? 'Nothing to compare yet: take a snapshot with Snapshot now.' : 'No boot span yet: the panes\\' ready snapshots haven\\'t been taken.'))
    return out
  }
  const flagsOf = span.flags || []
  const reason = (flagsOf.find(f => f.kind === 'unreadable') || {}).reason
  // why a span is incomplete, per pane: a base pane missing excuses
  // nothing; a PR pane missing leaves its changes unknown; windows that
  // differ excuse nothing; an answer too big lists nothing
  const missing = ['base', 'pr'].filter(pane => !span[pane])
  if (span.unlisted) {
    out.push(node('p', 'dataErr', 'This span\\'s details were too big to list: its counts and first red flags are below, and nothing else.'))
  } else {
    if (!span.base) out.push(node('p', 'dataErr', 'Incomplete: the BASE pane has no data for this span, so nothing it did can excuse a change.'))
    if (!span.pr) {
      out.push(node('p', 'dataErr', reason === 'baseline'
        ? 'Incomplete: the PR pane\\'s baseline is this snapshot, so it has no changes to show yet.'
        : 'Incomplete: the PR pane has no data for this span, so its changes are unknown.'))
    }
  }
  if (span.aligned === false) {
    out.push(node('p', 'dataErr', `Incomplete: the panes' windows differ (a pane's ready read failed, and a later snapshot is its baseline), so nothing in the base pane can excuse a change. ${ui.span === 'session' ? 'Re-baseline to compare both from one moment.' : 'The boot span stays as it was: a Re-baseline aligns only the session span.'}`))
  }
  // the flags, red first, at most SHOWN_FLAGS, and how many more there are
  const flags = [...flagsOf].sort((a, b) => (a.severity === 'red' ? 0 : 1) - (b.severity === 'red' ? 0 : 1))
  const total = Math.max(flagTotal({ ...span, flags }), flags.length)
  if (total || !span.pr) {
    const items = flags.slice(0, SHOWN_FLAGS).map(f => node('li', `flag ${f.severity === 'red' ? 'red' : 'amber'}`, flagText(f)))
    if (!span.pr && !span.unlisted && !flags.some(f => f.kind === 'unreadable')) items.unshift(node('li', 'flag red', flagText({ kind: 'unreadable' })))
    const shownFlags = items.length
    if (total > shownFlags) items.push(node('li', 'stepSub', `and ${total - shownFlags} more flags`))
    out.push(node('ul', 'flags', undefined, { children: items }))
  } else out.push(node('p', 'stepSub', 'No destructive change.'))
  if (span.unlisted) return out""")

sub("""    const c = pane.collections[name]
    const counts = c.counts || { inserted: c.inserted.length, updated: c.updated.length, deleted: c.deleted.length }
    return [isolated(name), label(STATUS_LABELS, c.status), deltaText(counts), `${c.countBefore} → ${c.countAfter}`]
  }""", """    const c = pane.collections[name]
    const counts = c.counts || { inserted: c.inserted.length, updated: c.updated.length, deleted: c.deleted.length }
    return [isolated(name), statusText(c), deltaText(counts), `${countText(c.countBefore)} → ${countText(c.countAfter)}`]
  }""")
sub("""      return [isolated(name), deltaText(c.counts.base), deltaText(c.counts.pr), label(STATUS_LABELS, c.status)]""",
    """      return [isolated(name), deltaText(c.counts.base), deltaText(c.counts.pr), statusText(c)]""")
sub("""  if (names.length > shown.length) out.push(node('p', 'stepSub', `and ${names.length - shown.length} more collections`))""",
    """  const all = collectionsTotal(span, ui.view)
  if (all > shown.length) out.push(node('p', 'stepSub', `and ${all - shown.length} more collections`))""")
sub("""  for (const [title, fields] of [['Fields dropped', c.fieldsDropped], ['Fields added', c.fieldsAdded]]) {
    if (fields && fields.length) out.push(node('p', 'stepSub', `${title}: ${fields.map(isolated).join(', ')}`))
  }""", """  for (const [title, fields, total] of [['Fields dropped', c.fieldsDropped, counts.fieldsDropped], ['Fields added', c.fieldsAdded, counts.fieldsAdded]]) {
    if (!fields || !fields.length) continue
    const more = Number.isSafeInteger(total) ? total - fields.length : 0
    out.push(node('p', 'stepSub', `${title}: ${fields.map(isolated).join(', ')}${more > 0 ? `, and ${more} more` : ''}`))
  }""")
open(p, 'w').write(s)
print('ok')
