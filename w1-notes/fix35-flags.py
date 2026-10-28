p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-diff.mjs'
s = open(p).read()
start = s.index("const KINDS = ['delete', 'emptied', 'dropped', 'column-dropped', 'mass-change', 'cleared']")
end = s.index("// Whether a multiset holds every item of another.")
new = '''const KINDS = ['delete', 'emptied', 'dropped', 'column-dropped', 'mass-change', 'key-lost', 'unverified', 'cleared']

// The PR pane's destructive changes, from its diff and the base pane's over
// the same span:
// - delete: rows gone, or newly soft-deleted (a softDelete field set);
// - emptied: a collection whose count fell to 0;
// - dropped: a collection gone;
// - column-dropped: a declared field gone, per field;
// - mass-change: more than 20 rows updated or deleted, or more than 20% of
//   a collection of at least 5 (or past a destructive rule's maxChanged);
// - key-lost: a collection whose key the after snapshot no longer bears out
//   (two rows share it), so its rows were compared without one;
// - unverified: a collection the PR pane's snapshot cut short where the base
//   pane's didn't, or a cut-short one whose count changed: what happened
//   past the cut can't be seen, so it is never taken for nothing;
// - cleared: a value set before, null, '', [] or {} now, per field.
// `shared` says the base made the same change: the same rows by key (or the
// same rows, without one), with the same fields changed, the same field, or
// for two cut-short collections the same count change, no fewer rows. A
// count stands for rows only when both sides have only counts. A flag is
// amber when it is shared and the session is trusted (`trusted: true`, its
// isolation verdict `isolated`), else red. A cleared field is amber at most.
// A destructive rule's allowDeletes lets a collection's deletes go
// unflagged, not its emptying.
export function flagChanges(baseDiff, prDiff, rules, { trusted }) {
  const base = tally(baseDiff, rules)
  const pr = tally(prDiff, rules)
  const flags = []
  for (const [name, kinds] of pr) {
    for (const [id, mine] of kinds) {
      const theirs = base.get(name)?.get(id)
      const shared = theirs !== undefined && (mine.items === null && theirs.items === null
        ? mine.n <= theirs.n
        : mine.items !== null && theirs.items !== null && includes(theirs.items, mine.items))
      const severity = mine.kind === 'cleared' || (trusted === true && shared) ? 'amber' : 'red'
      flags.push({ collection: name, kind: mine.kind, severity, shared, pr: mine.n, base: theirs?.n ?? 0, ...(mine.field === null ? {} : { field: mine.field }) })
    }
  }
  // cut short in the PR pane only, or cut short with its count changed
  for (const name of Object.keys(prDiff.collections)) {
    const c = own(prDiff.collections, name)
    if (!c.truncated || c.status === 'dropped') continue
    const b = own(baseDiff.collections, name)
    const changed = c.countBefore !== c.countAfter
    if (b?.truncated && !changed) continue
    const shared = Boolean(b?.truncated) && b.countBefore === c.countBefore && b.countAfter === c.countAfter
    flags.push({ collection: name, kind: 'unverified', severity: trusted === true && shared ? 'amber' : 'red', shared, pr: 1, base: b?.truncated ? 1 : 0 })
  }
  const order = (x, y) => (x.collection < y.collection ? -1 : x.collection > y.collection ? 1 : 0)
    || KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind)
    || String(x.field).localeCompare(String(y.field))
  return flags.sort(order)
}

'''
s = s[:start] + new + s[end:]

a = """    if (mass) add('mass-change', null, changed, c.truncated ? null : [...c.updated.map(u => u.key), ...c.deleted.map(rowId)])"""
b = """    // a row with which of its fields changed: the same rows with other
    // fields changed are another change
    const updateId = u => `${u.key} ${u.fields.map(f => f.field).sort().join(',')}`
    if (mass) add('mass-change', null, changed, c.truncated ? null : [...c.updated.map(updateId), ...c.deleted.map(rowId)])
    if (c.keyLost) add('key-lost', null, 1, ['key-lost'])"""
assert a in s
s = s.replace(a, b, 1)
open(p, 'w').write(s)
print('ok')
