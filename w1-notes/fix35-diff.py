p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-diff.mjs'
s = open(p).read()

# diffSnapshots: a key lost
a = """    const key = b.key && a.key && canon(b.key) === canon(a.key) ? b.key : null
    const out = changeOf('same', b, a, key)"""
b = """    const key = b.key && a.key && canon(b.key) === canon(a.key) ? b.key : null
    const out = changeOf('same', b, a, key)
    // a key the before snapshot had and the after one hasn't (two rows now
    // share it, say): its rows are compared as a multiset, which turns updates
    // into deletes and inserts
    out.keyLost = Boolean(b.key) && key === null"""
assert a in s
s = s.replace(a, b, 1)
a = """      if (out.inserted.length || out.deleted.length || out.updated.length || schema.size || b.count !== a.count) out.status = 'changed'"""
b = """      if (out.inserted.length || out.deleted.length || out.updated.length || schema.size || b.count !== a.count || out.keyLost) out.status = 'changed'"""
assert a in s
s = s.replace(a, b, 1)
a = """    countAfter: a ? a.count : 0,
    truncated: Boolean(b?.truncated || a?.truncated),
  }
}"""
b = """    countAfter: a ? a.count : 0,
    truncated: Boolean(b?.truncated || a?.truncated),
    keyLost: false,
  }
}"""
assert a in s
s = s.replace(a, b, 1)

# divergence: truncated on one side only can't be compared
a = """    const truncated = Boolean(b?.truncated || p?.truncated)"""
b = """    const truncated = Boolean(b?.truncated || p?.truncated)
    // truncated on one side only: the other's rows and this one's count
    // can't be set side by side
    const oneSided = Boolean(b && p && b.truncated !== p.truncated)"""
assert a in s
s = s.replace(a, b, 1)
a = """      status = sumUp([...schema.map(c => c.status), byCounts(counts)])
      if (truncated && status === 'same') status = 'unknown'"""
b = """      status = oneSided ? 'unknown' : sumUp([...schema.map(c => c.status), byCounts(counts)])
      if (truncated && status === 'same') status = 'unknown'"""
assert a in s
s = s.replace(a, b, 1)
open(p, 'w').write(s)
print('ok')
