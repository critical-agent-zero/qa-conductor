import json
H = 'public/harness.js'
HT = ['test/harness.test.mjs']
m = [
    ('T1 badge ignores flagsCount', "    if (span.flagsCount && Number.isSafeInteger(span.flagsCount.red)) return span.flagsCount.red\n", ""),
    ('T2 no unreadable text', "  if (f.kind === 'unreadable') return 'The PR pane couldn\\'t be read for this span, so its changes are unknown.'\n", ""),
    ('T3 no pr no flags', "  if (total || !span.pr) {", "  if (total) {"),
    ('T4 separators raw', "const CONTROLS = /[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu", "const CONTROLS = /[\\p{Cc}\\p{Cf}]/gu"),
    ('T4b separators raw drawn', "const OTHER_CONTROLS = /(?![\\u2068\\u2069])[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu", "const OTHER_CONTROLS = /(?![\\u2068\\u2069])[\\p{Cc}\\p{Cf}]/gu"),
    ('T5 cut digest shown', "  if (cell.t === 'long') return `${isolated(hideCutDigests(String(cell.s)))}", "  if (cell.t === 'long') return `${isolated(hideDigests(String(cell.s)))}"),
    ('T6 pr missing as excuse', "  if (!span.pr) out.push(node('p', 'dataErr', 'Incomplete: the PR pane has no data for this span, so its changes are unknown.'))", "  if (!span.pr) out.push(node('p', 'dataErr', 'Incomplete: the PR pane has no data for this span, so nothing it did can excuse a change.'))"),
    ('T7 no unaligned line', "  if (span.aligned === false) {", "  if (false) {"),
    ('T8 one baseline', "  if (b && b.base && b.pr && b.base !== b.pr) return", "  if (false) return"),
    ('T9 more from list', "  const total = Math.max(flagTotal(span), flags.length)", "  const total = flags.length"),
    ('T10 class from data', "node('li', `flag ${f.severity === 'red' ? 'red' : 'amber'}`, flagText(f))", "node('li', `flag ${f.severity}`, flagText(f))"),
    ('T11 after window', "const after = p < end ? marks[p] : null", "const after = p < marks.length ? marks[p] : null"),
    ('T12 tie higher seq', "a.at - b.at || a.seq - b.seq)\n  const groups", "a.at - b.at || b.seq - a.seq)\n  const groups"),
    ('T13 secret field raw', "`${isolated(f.field)}: (secret, changed)`", "`${f.field}: (secret, changed)`"),
    ('T14 session error raw', "`${paneName(pane)}: ${isolated(session)}`", "`${paneName(pane)}: ${drawnText(session)}`"),
    ('T15 problem raw', "`${paneName(pane)}: ${isolated(problem)}`", "`${paneName(pane)}: ${drawnText(problem)}`"),
    ('T16 json raw', "  if (cell.t === 'json') return isolated(hideDigests(String(cell.s)))", "  if (cell.t === 'json') return hideDigests(String(cell.s))"),
    ('T17 failed read unguarded', "    } catch (err) {\n      if (S.mounted !== mounted) return\n", "    } catch (err) {\n"),
    ('T18 polls twice', "    if (want && !A.timer) {", "    if (want) {"),
]
json.dump([{'id': i, 'file': H, 'old': o, 'new': n, 'tests': HT} for i, o, n in m],
          open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-37r2.json', 'w'), indent=1)
print(len(m))
