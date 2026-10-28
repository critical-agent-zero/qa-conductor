p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/public/harness.js'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("""// Text PR code controls, as the panels draw it: each control or format
// character (a newline, a bidi override, a zero-width space) shown as its
// code, so it can't break a line, reorder the text around it or hide; then""",
    """// Text PR code controls, as the panels draw it: each control, format or
// separator character (a newline, a bidi override, a zero-width space, a
// line or paragraph separator) shown as its code, so it can't break a line,
// end an isolate, reorder the text around it or hide; then""")
sub("const CONTROLS = /[\\p{Cc}\\p{Cf}]/gu", "const CONTROLS = /[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu")
sub("const OTHER_CONTROLS = /(?![\\u2068\\u2069])[\\p{Cc}\\p{Cf}]/gu", "const OTHER_CONTROLS = /(?![\\u2068\\u2069])[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu")

sub("""const hideDigests = s => s
  .replace(/\\[secret [0-9a-f]{8}\\]/g, '[secret]')
  .replace(/(\\[text with a secret-looking key, \\d+ characters), [0-9a-f]{8}\\]/g, '$1]')""",
    """const hideDigests = s => s
  .replace(/\\[secret [0-9a-f]{8}\\]/g, '[secret]')
  .replace(/(\\[text with a secret-looking key, \\d+ characters), [0-9a-f]{8}\\]/g, '$1]')
// A value the engine cut at MAX_TEXT may end in part of one.
const hideCutDigests = s => hideDigests(s)
  .replace(/\\[secret [0-9a-f]{0,8}$/, '[secret')
  .replace(/(\\[text with a secret-looking key, \\d+ characters), [0-9a-f]{0,8}$/, '$1')""")
sub("""  if (cell.t === 'long') return `${isolated(hideDigests(String(cell.s)))}… (${cell.len} characters)`""",
    """  if (cell.t === 'long') return `${isolated(hideCutDigests(String(cell.s)))}… (${cell.len} characters)`""")

sub("""  ['mass-change', 'mass change'], ['key-lost', 'key lost'], ['unverified', 'unverified (cut short)'], ['cleared', 'value cleared'],""",
    """  ['mass-change', 'mass change'], ['key-lost', 'key lost'], ['unverified', 'unverified (cut short or not shown)'], ['cleared', 'value cleared'],""")
sub("""function flagText(f) {
  const field = f.field === undefined ? '' : ` (${isolated(f.field)})`""", """function flagText(f) {
  if (f.kind === 'unreadable') return 'The PR pane couldn\\'t be read for this span, so its changes are unknown.'
  const field = f.field === undefined ? '' : ` (${isolated(f.field)})`""")

sub("""// The Data button's badge: the red flags, both spans. Red is a change the
// base didn't make too in a trusted session, and any destructive change in
// an advisory one, where what the base did excuses nothing.
function dataBadge(data) {
  if (!data || !data.active || data.closed) return 0
  return ['boot', 'session'].reduce((n, span) => n + ((data[span] && data[span].flags) || []).filter(f => f.severity === 'red').length, 0)
}""", """// The Data button's badge: the red flags, both spans, those the answer
// lists and the rest (flagsCount). Red is a change the base didn't make too
// in a trusted session, any destructive change in an advisory one, where
// what the base did excuses nothing, and a PR pane that couldn't be read.
function dataBadge(data) {
  if (!data || !data.active || data.closed) return 0
  const redOf = span => {
    if (!span) return 0
    if (span.flagsCount && Number.isSafeInteger(span.flagsCount.red)) return span.flagsCount.red
    return (span.flags || []).filter(f => f.severity === 'red').length
  }
  return redOf(data.boot) + redOf(data.session)
}
// How many flags a span has in all.
const flagTotal = span => (span.flagsCount && Number.isSafeInteger(span.flagsCount.red) && Number.isSafeInteger(span.flagsCount.amber)
  ? span.flagsCount.red + span.flagsCount.amber
  : span.flags.length)""")

sub("""      node('span', 'stepSub', `baseline ${data.baselineAt ? clockTime(data.baselineAt) : '—'}${data.rebaselined ? ' (re-baselined)' : ''} · compared ${data.comparedAt ? clockTime(data.comparedAt) : '—'}`),""",
    """      node('span', 'stepSub', `${baselineText(data)}${data.rebaselined ? ' (re-baselined)' : ''} · compared ${data.comparedAt ? clockTime(data.comparedAt) : '—'}`),""")
sub("""  const missing = ['base', 'pr'].filter(pane => !span[pane])
  if (missing.length) {
    out.push(node('p', 'dataErr', `Incomplete: the ${missing.map(paneName).join(' and ')} pane has no data for this span, so nothing it did can excuse a change.`))
  }
  // the flags, red first, at most SHOWN_FLAGS
  const flags = [...span.flags].sort((a, b) => (a.severity === 'red' ? 0 : 1) - (b.severity === 'red' ? 0 : 1))
  if (flags.length) {
    const items = flags.slice(0, SHOWN_FLAGS).map(f => node('li', `flag ${f.severity === 'red' ? 'red' : 'amber'}`, flagText(f)))
    if (flags.length > SHOWN_FLAGS) items.push(node('li', 'stepSub', `and ${flags.length - SHOWN_FLAGS} more flags`))
    out.push(node('ul', 'flags', undefined, { children: items }))
  } else out.push(node('p', 'stepSub', 'No destructive change.'))""", """  // why a span is incomplete, per pane: a base pane missing excuses
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
  } else out.push(node('p', 'stepSub', 'No destructive change.'))""")

sub("""// A local time of day, HH:MM:SS.
function clockTime(at) {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '—' : d.toTimeString().slice(0, 8)
}""", """// A local time of day, HH:MM:SS.
function clockTime(at) {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '—' : d.toTimeString().slice(0, 8)
}
// When the baseline was taken: one time, or each pane's when they differ.
function baselineText(data) {
  const b = data.baselines
  if (b && b.base && b.pr && b.base !== b.pr) return `baselines BASE ${clockTime(b.base)}, PR ${clockTime(b.pr)}`
  return `baseline ${data.baselineAt ? clockTime(data.baselineAt) : '—'}`
}""")

# the dead read in mountPanels: both panels are closed by unmountPanels first
sub("""    if (S.dataAvailable) loadData()
    if (A.open) readActions()
  }""", """    if (S.dataAvailable) loadData()
  }""")
open(p, 'w').write(s)
print('ok')
