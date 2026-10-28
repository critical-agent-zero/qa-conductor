R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'test/harness.test.mjs'
s = open(R + P).read()


def sub(a, b, count=1):
    global s
    assert s.count(a) == count, (a[:120], s.count(a))
    s = s.replace(a, b)


# open by name
sub("""  assert.deepEqual(actsOf(nodes), ['snapshot', 'rebaseline', 'span:session', 'span:boot', 'view:divergence', 'view:base', 'view:pr', 'open:0'])""",
    """  // the flag and the row each open the collection, by name
  const name = `saved_carts${HOSTILE}`
  assert.deepEqual(actsOf(nodes), ['snapshot', 'rebaseline', 'span:session', 'span:boot', 'view:divergence', 'view:base', 'view:pr', `open:${name}`, `open:${name}`])""")
sub("""  const open = textsOf(dataNodes(sampleData(), { ...ui, open: 0 }))""",
    """  const open = textsOf(dataNodes(sampleData(), { ...ui, open: name }))""")
sub("""  const pr = textsOf(dataNodes(sampleData(), { span: 'session', view: 'pr', open: 0 }))""",
    """  const pr = textsOf(dataNodes(sampleData(), { span: 'session', view: 'pr', open: name }))""")
sub("""  const texts = textsOf(dataNodes(data, { span: 'session', view: 'base', open: 0 }))
  assert.equal(texts.filter(t => /^\\[\\d+\\]: id: \\d+$/.test(t)).length, 50)""",
    """  const texts = textsOf(dataNodes(data, { span: 'session', view: 'base', open: 'c' }))
  assert.equal(texts.filter(t => /^\\[\\d+\\]: id: \\d+$/.test(t)).length, 50)""")
sub("""divergence: div, flags: [] } }), { span: 'session', view: 'divergence', open: 0 }))
  assert.ok(d.includes('and 25 more'))""",
    """divergence: div, flags: [] } }), { span: 'session', view: 'divergence', open: 'c' }))
  assert.ok(d.includes('and 25 more'))""")
sub("""  const nodes = dataNodes(data, { span: 'session', view: 'pr', open: 299 })
  assert.equal(actsOf(nodes).filter(a => a.startsWith('open:')).length, 300)""",
    """  const nodes = dataNodes(data, { span: 'session', view: 'pr', open: 'c0279' })
  assert.equal(nodes.find(n => n.cls === 'dataTable').children.slice(1).filter(r => r.act && r.act.startsWith('open:')).length, 300)""")
sub("""  for (const view of ['divergence', 'base', 'pr']) raws.push(...rawTextsOf(dataNodes(data, { span: 'session', view, open: 0 })))""",
    """  for (const view of ['divergence', 'base', 'pr']) raws.push(...rawTextsOf(dataNodes(data, { span: 'session', view, open: name })))""")
sub("""  const raws = rawTextsOf(dataNodes(data, { span: 'session', view: 'pr', open: 0 }))
  for (const want of""",
    """  const raws = rawTextsOf(dataNodes(data, { span: 'session', view: 'pr', open: name }))
  for (const want of""")
sub("""  const nodes = dataNodes(data, { span: 'session', view: 'pr', open: 0 })
  const rows = nodes.find(n => n.cls === 'dataTable').children.slice(1).map(r => plain(r.children[0].text))
  assert.equal(rows[0], 'users', 'the changed one first, though it sorts last')""",
    """  const nodes = dataNodes(data, { span: 'session', view: 'pr', open: 'users' })
  const rows = nodes.find(n => n.cls === 'dataTable').children.slice(1).map(r => plain(r.children[0].text))
  assert.equal(rows[0], 'users', 'the changed one first, though it sorts last')""")
sub("""divergence: null, flags: [] } }), { span: 'session', view: 'pr', open: 0 }))
  assert.ok(w.some(t => t.startsWith('Fields dropped: f0, f1')""",
    """divergence: null, flags: [] } }), { span: 'session', view: 'pr', open: 'c' }))
  assert.ok(w.some(t => t.startsWith('Fields dropped: f0, f1')""")
# the unlisted sentence, once
sub("""  assert.ok(u.includes('This span\\'s details were too big to list: its counts and first red flags are below, and nothing else.'))
  assert.ok(u.includes('This span\\'s details were too big to list: only its counts and first red flags are shown.'))""",
    """  assert.equal(u.filter(t => t.includes('too big to list')).length, 1, u.join('\\n'))
  assert.ok(u.includes('This span\\'s details were too big to list: only its first red flags are shown, with how many flags it has in all.'))""")

s += r"""
// --- Round 4 of #37's review ---------------------------------------------------------

// The review's medium, through the real capture: the panel ranked tables
// itself (red, then not same, then by name), so padding pushed users out of
// the 300 drawn. It follows the engine's flag order now, like the answer.
test('the tables drawn follow the engine\'s order: 300 new empty tables, or 300 PR tables with a red flag each, can\'t push users out', async () => {
  // 300 new empty tables, and 3 users' emails rewritten (no flag covers it)
  const people = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@example.com` }))
  let pr = { users: { key: ['id'], rows: people(20) } }
  const base = { users: { key: ['id'], rows: people(20) } }
  const open = role => ({ snapshot: () => ({ collections: structuredClone(role === 'base' ? base : pr) }) })
  const capture = createDataCapture({ inspector: { open: ({ paneRef }) => open(paneRef.role) }, rules: validateRules({}) })
  const signal = new AbortController().signal
  for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
  await capture.ready({ signal })
  const pad = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`a${String(i).padStart(3, '0')}`, { key: ['id'], rows: [] }]))
  pr = { ...pad, users: { key: ['id'], rows: people(20).map((r, i) => (i < 3 ? { ...r, email: `x${i}@example.com` } : r)) } }
  await capture.snapshot()
  for (const view of ['divergence', 'pr']) {
    const nodes = dataNodes(capture.view({ isolation: { verdict: 'isolated' } }), { span: 'session', view, open: null })
    const rows = nodes.find(n => n.cls === 'dataTable').children.slice(1).map(r => plain(r.children[0].text))
    assert.equal(rows[0], 'users', view)
  }
  await capture.close()
  // the PR's migration makes 300 tables; the session deletes a row of each,
  // and 15 of 20 users
  const users = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const own = rows => Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`a${String(i).padStart(3, '0')}`, users(rows)]))
  const base2 = { users: users(20) }
  let pr2 = base2
  const cap2 = createDataCapture({ inspector: { open: ({ paneRef }) => ({ snapshot: () => ({ collections: structuredClone(paneRef.role === 'base' ? base2 : pr2) }) }) }, rules: validateRules({}) })
  for (const role of ['base', 'pr']) await cap2.seeded({ paneRef: { role }, db: null, databases: [], signal })
  pr2 = { ...own(2), users: users(20) }
  await cap2.ready({ signal })
  pr2 = { ...own(1), users: users(5) }
  await cap2.snapshot()
  const data = cap2.view({ isolation: { verdict: 'isolated' } })
  for (const view of ['divergence', 'pr']) {
    const nodes = dataNodes(data, { span: 'session', view, open: null })
    const rows = nodes.find(n => n.cls === 'dataTable').children.slice(1).map(r => plain(r.children[0].text))
    assert.equal(rows[0], 'users', view)
  }
  // its flag opens it, by name
  const flagged = dataNodes(data, { span: 'session', view: 'pr', open: null }).find(n => n.cls === 'flags').children[0]
  assert.equal(flagged.act, 'open:users')
  assert.ok(textsOf(dataNodes(data, { span: 'session', view: 'pr', open: 'users' })).includes('Deleted'))
  await cap2.close()
})

// The ranks past red: rows moved, then amber, then any other change
// (unknown included), then the rest.
test('past red flags, tables rank by rows moved, an amber flag, any other change, then the rest', () => {
  const pane = DIFF({
    a_same: counted(coll({ status: 'same' })),
    b_unknown: counted(coll({ status: 'unknown', truncated: true })),
    c_amber: counted(coll({ status: 'same' })),
    d_moved: counted(coll({ deleted: [{ key: '[1]', row: { id: 1 } }] })),
    e_red: counted(coll({ status: 'same' })),
  })
  const flags = [{ collection: 'e_red', kind: 'delete', severity: 'red', shared: false, pr: 1, base: 0 }, { collection: 'c_amber', kind: 'cleared', severity: 'amber', shared: true, pr: 1, base: 1, field: 'f' }]
  const nodes = dataNodes(sampleData({ session: { complete: true, base: pane, pr: pane, divergence: null, flags } }), { span: 'session', view: 'pr', open: null })
  const rows = nodes.find(n => n.cls === 'dataTable').children.slice(1).map(r => plain(r.children[0].text))
  assert.deepEqual(rows, ['e_red', 'd_moved', 'c_amber', 'b_unknown', 'a_same'])
})

test('the open table is kept by name across answers, shown wherever it ranks; one this view doesn\'t list says so', () => {
  const names = Array.from({ length: 400 }, (_, i) => `c${String(i).padStart(3, '0')}`)
  const pane = DIFF(Object.fromEntries(names.map(n => [n, counted(coll())])))
  const data = sampleData({ session: { complete: true, base: pane, pr: pane, divergence: null, flags: [] } })
  // c399 isn't among the 300 drawn, but opens
  const texts = textsOf(dataNodes(data, { span: 'session', view: 'pr', open: 'c399' }))
  assert.ok(texts.includes('c399'))
  assert.ok(texts.includes('and 100 more collections'))
  // a name the view doesn't list
  assert.ok(textsOf(dataNodes(data, { span: 'session', view: 'pr', open: 'gone' })).includes('gone isn\'t listed in this view.'))
  // a name like an Object member opens nothing
  assert.ok(textsOf(dataNodes(data, { span: 'session', view: 'pr', open: 'constructor' })).includes('constructor isn\'t listed in this view.'))
})

test('a list or a collection the answer\'s size cut says so; a folded flag counts as its collections in "and N more flags"', () => {
  const pane = { ...DIFF({ users: { ...counted(coll()), cut: true } }), cut: true, collectionsCount: 50 }
  const texts = textsOf(dataNodes(sampleData({ session: { complete: true, base: pane, pr: pane, divergence: null, flags: [] } }), { span: 'session', view: 'pr', open: 'users' }))
  assert.ok(texts.includes('Cut short: the answer\'s size limit stopped this list, so some collections aren\'t listed.'), texts.join('\n'))
  assert.ok(texts.includes('Cut short: the answer\'s size limit stopped its lists.'))
  assert.ok(texts.includes('and 49 more collections'), 'the "more" line when fewer than 300 are listed')
  // 20 named unverified flags, one folded for 10 more, and 2 more past them
  const flags = [
    ...Array.from({ length: 20 }, (_, i) => ({ collection: `t${i}`, kind: 'unverified', severity: 'red', shared: false, pr: 1, base: 0 })),
    { collection: null, kind: 'unverified', severity: 'red', shared: false, pr: 10, base: 0, collections: 10, names: [`n${HOSTILE}`], folded: true },
  ]
  const f = dataNodes(sampleData({ session: { complete: true, base: pane, pr: pane, divergence: null, flags, flagsCount: { red: 32, amber: 0 } } }), { span: 'session', view: 'pr', open: null })
  const ft = textsOf(f)
  assert.ok(ft.includes('and 2 more flags'), ft.filter(t => /more flags/.test(t)).join('\n'))
  // the folded flag's names are set apart
  assert.ok(rawTextsOf(f).some(t => t.includes(`\u2068n${HOSTILE}\u2069`)))
})

// The review's low: two states with a late PR baseline still said
// "Neither pane could be read", and the header "baseline —".
test('a late PR baseline says so whatever the reason, keyed on baselines.pr: both ready reads failed, or the base\'s now read failed', () => {
  const t = Date.UTC(2026, 9, 22, 12, 0, 0)
  const neither = [{ collection: null, kind: 'unreadable', severity: 'red', shared: false, pr: 1, base: 0, reason: 'neither' }]
  // both ready reads failed, then a good Snapshot now: one shared time
  const both = sampleData({ baselineAt: null, baselines: { base: t, pr: t }, comparedAt: t, errors: NO_ERRORS, session: { complete: false, aligned: true, base: null, pr: null, divergence: null, flags: neither, flagsCount: { red: 1, amber: 0 } } })
  const a = textsOf(dataNodes(both, { span: 'session', view: 'divergence', open: null }))
  assert.ok(a.includes('The PR pane\'s baseline is this snapshot: take another to see its changes.'), a.join('\n'))
  assert.equal(a.some(t => t.startsWith('Neither pane could be read')), false)
  assert.ok(a.some(t => /^baseline \d\d:\d\d:\d\d · compared /.test(t)), a.join('\n'))
  // the base's now read failed, the PR's became its baseline
  const half = sampleData({ baselines: { base: 1, pr: t }, comparedAt: t, errors: { boot: { base: null, pr: null }, session: { base: 'busy', pr: null } }, session: { complete: false, aligned: false, base: null, pr: null, divergence: null, flags: neither, flagsCount: { red: 1, amber: 0 } } })
  const b = textsOf(dataNodes(half, { span: 'session', view: 'divergence', open: null }))
  assert.ok(b.includes('The PR pane\'s baseline is this snapshot: take another to see its changes.'), b.join('\n'))
  // with no span at all
  assert.ok(textsOf(dataNodes({ ...both, session: null }, { span: 'session', view: 'divergence', open: null })).includes('The PR pane\'s baseline is this snapshot: take another to see its changes.'))
  // a PR read that failed is no late baseline
  const failed = { ...both, errors: { boot: NO_ERRORS.boot, session: { base: null, pr: 'busy' } } }
  assert.ok(textsOf(dataNodes(failed, { span: 'session', view: 'divergence', open: null })).includes('Neither pane could be read for this span, so the PR pane\'s changes are unknown.'))
})

test('nits: plural panes, an unreadable reason named like an Object member, the neither line in red, and a divergence entry a snapshot left out', () => {
  const none = sampleData()
  none.session = { ...none.session, complete: false, base: null, pr: null, divergence: null }
  assert.ok(textsOf(dataNodes(none, { span: 'session', view: 'divergence', open: null })).includes('No divergence: it needs both panes\' data, and the BASE and PR panes have none for this span.'))
  assert.equal(plain(flagText({ collection: null, kind: 'unreadable', reason: 'constructor' })), 'The PR pane couldn\'t be read for this span, so its changes are unknown.')
  const bare = dataNodes({ ...sampleData(), session: null, comparedAt: 2 }, { span: 'session', view: 'divergence', open: null })
  assert.equal(bare.find(n => n.cls === 'flags').children[0].cls, 'flag red')
  // a collection a pane's snapshot left out: its divergence entry says so
  const left = counted(coll({ status: 'unknown', omitted: 'after', truncated: true, countAfter: null }))
  const div = DIFF({ users: { status: 'unknown', truncated: true, counts: { base: { inserted: 0, updated: 0, deleted: 0 }, pr: { inserted: 0, updated: 0, deleted: 0 } }, changes: [], changesCount: 0 } })
  const d = textsOf(dataNodes(sampleData({ session: { complete: true, base: DIFF({ users: counted(coll({ status: 'same' })) }), pr: DIFF({ users: left }), divergence: div, flags: [] } }), { span: 'session', view: 'divergence', open: null }))
  assert.ok(d.includes('unknown (left out of a snapshot)'), d.join('\n'))
  // a column-dropped flag names its count, its seeded ones and the first few
  assert.equal(plain(flagText({ collection: 'users', kind: 'column-dropped', severity: 'red', shared: false, pr: 6, base: 0, count: 6, seeded: 1, fields: ['email', 'aa_tmp_0000', 'aa_tmp_0001', 'aa_tmp_0002', 'aa_tmp_0003'] })), 'users: column dropped (6, 1 seeded: email, aa_tmp_0000, aa_tmp_0001, aa_tmp_0002, aa_tmp_0003, …), PR 6, base 0')
})
"""
open(R + P, 'w').write(s)
print('ok')
