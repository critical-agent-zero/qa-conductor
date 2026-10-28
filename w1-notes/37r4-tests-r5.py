R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
T = 'test/harness.test.mjs'
t = open(R + T).read()
anchor = "// The ranks past red: rows moved, then amber, then any other change\n"
assert t.count(anchor) == 1
new = r"""// #36's round 5: the answer lists every flag of the base pane's (seeded)
// collections first, amber ones too, and ranks a seeded collection before
// the PR's own red tables. The panel keeps that order, and doesn't take
// the answer's key order, which puts a name like `0` first.
test('the panel keeps the answer\'s order: a seeded amber flag and a seeded change come before the PR\'s own red tables, numeric names too', async () => {
  const { createDataCapture } = await import('../lib/data-capture.mjs')
  const signal = new AbortController().signal
  const people = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@example.com` }))
  const rowsOf = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const shapes = {
    // 4 of 20 emails cleared (amber), and a row deleted from each of 300 own tables (red)
    'an amber seeded flag': { users: rows => rows.map((r, i) => (i < 4 ? { ...r, email: null } : r)), name: i => `a${String(i).padStart(3, '0')}` },
    // 3 emails rewritten (no flag), and the own tables named 0 to 299
    'an unflagged seeded change, numeric names': { users: rows => rows.map((r, i) => (i < 3 ? { ...r, email: `x${i}@example.com` } : r)), name: i => String(i) },
  }
  for (const [shape, { users, name }] of Object.entries(shapes)) {
    const own = n => Object.fromEntries(Array.from({ length: 300 }, (_, i) => [name(i), rowsOf(n)]))
    const base = { users: { key: ['id'], rows: people(20) } }
    let pr = base
    const capture = createDataCapture({ inspector: { open: ({ paneRef }) => ({ snapshot: () => ({ collections: structuredClone(paneRef.role === 'base' ? base : pr) }) }) }, rules: validateRules({}) })
    for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
    pr = { ...base, ...own(2) }
    await capture.ready({ signal })
    pr = { users: { key: ['id'], rows: users(people(20)) }, ...own(1) }
    await capture.snapshot()
    const data = capture.view({ isolation: { verdict: 'isolated' } })
    assert.equal(data.session.flagsCount.red, 300, shape)
    for (const view of ['divergence', 'pr']) {
      const nodes = dataNodes(data, { span: 'session', view, open: null })
      const rows = nodes.find(n => n.cls === 'dataTable').children.slice(1).map(r => plain(r.children[0].text))
      assert.equal(rows[0], 'users', `${shape}, ${view}`)
    }
    const flags = dataNodes(data, { span: 'session', view: 'pr', open: null }).find(n => n.cls === 'flags').children
    if (shape === 'an amber seeded flag') assert.deepEqual([flags[0].cls, flags[0].act], ['flag amber', 'open:users'])
    else assert.equal(flags[0].cls, 'flag red')
    await capture.close()
  }
})

// Without the base diff's list, a red flag still ranks first by the
// answer's flag order; an amber flag ranks with the PR's own.
test('a table the base diff doesn\'t list ranks with the PR\'s own: a red flag by its place, then rows moved, then an amber flag', () => {
  const pane = DIFF({
    a_moved: counted(coll({ deleted: [{ key: '[1]', row: { id: 1 } }] })),
    b_amber: counted(coll({ status: 'same' })),
    c_red: counted(coll({ status: 'same' })),
    d_red: counted(coll({ status: 'same' })),
  })
  const flags = [
    { collection: 'd_red', kind: 'delete', severity: 'red', shared: false, pr: 1, base: 0 },
    { collection: 'b_amber', kind: 'cleared', severity: 'amber', shared: false, pr: 1, base: 0, field: 'f' },
    { collection: 'c_red', kind: 'dropped', severity: 'red', shared: false, pr: 1, base: 0 },
  ]
  const nodes = dataNodes(sampleData({ session: { complete: false, base: null, pr: pane, divergence: null, flags } }), { span: 'session', view: 'pr', open: null })
  assert.deepEqual(nodes.find(n => n.cls === 'dataTable').children.slice(1).map(r => plain(r.children[0].text)), ['d_red', 'c_red', 'a_moved', 'b_amber'])
  // and the flags as the answer gave them
  assert.deepEqual(nodes.find(n => n.cls === 'flags').children.map(n => n.cls), ['flag red', 'flag amber', 'flag red'])
})

"""
t = t.replace(anchor, new + anchor)
open(R + T, 'w').write(t)
print('ok')
