
// --- Round 3 of #37's review --------------------------------------------------------

// A capture through the real code, with an inspector whose reads the test
// can make hang.
async function realCapture() {
  const { createDataCapture } = await import('../lib/data-capture.mjs')
  const stores = { base: null, pr: null }
  let hang = false
  const capture = createDataCapture({
    inspector: { open: ({ paneRef, db }) => { stores[paneRef.role] = db; return { snapshot: () => (hang ? new Promise(() => {}) : { collections: structuredClone(stores[paneRef.role]) }) } } },
    rules: validateRules({}),
    limits: { timeoutMs: 20 },
  })
  const seed = () => ({ users: { key: ['id'], rows: Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })) } })
  const signal = new AbortController().signal
  for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: seed(), databases: [], signal })
  return { capture, stores, signal, hangReads: on => { hang = on } }
}

// The review's first medium: neither pane could be read after a snapshot,
// and the panel said "Nothing to compare yet", with the badge at 0.
test('a span neither pane could be read for, after a snapshot, is red and counted: never "Nothing to compare yet"', async () => {
  const { capture, stores, signal, hangReads } = await realCapture()
  await capture.ready({ signal })
  stores.pr.users.rows = stores.pr.users.rows.slice(15) // the PR deletes 15 of 20
  await capture.snapshot()
  assert.equal(dataBadge(capture.view({})), 2)
  hangReads(true)
  await capture.snapshot()
  const data = capture.view({})
  assert.equal(dataBadge(data), 1)
  const texts = textsOf(dataNodes(data, { span: 'session', view: 'divergence', open: null }))
  assert.ok(texts.includes('Neither pane could be read for this span, so the PR pane\'s changes are unknown.'), texts.join('\n'))
  assert.equal(texts.some(t => t.startsWith('Nothing to compare yet')), false)
  // only before any snapshot
  assert.ok(textsOf(dataNodes({ ...data, session: null, comparedAt: null }, { span: 'session', view: 'divergence', open: null })).includes('Nothing to compare yet: take a snapshot with Snapshot now.'))
  // an answer with no span after a snapshot still counts and says so
  const bare = { ...data, session: null }
  assert.equal(dataBadge(bare), (data.boot?.flagsCount?.red ?? 0) + 1)
  assert.ok(textsOf(dataNodes(bare, { span: 'session', view: 'divergence', open: null })).includes('Neither pane could be read for this span, so the PR pane\'s changes are unknown.'))
  await capture.close()
  // both ready reads failing: the boot span on mount
  const late = await realCapture()
  late.hangReads(true)
  await late.capture.ready({ signal: late.signal })
  const boot = late.capture.view({})
  assert.equal(dataBadge(boot), 1)
  assert.ok(textsOf(dataNodes(boot, { span: 'boot', view: 'divergence', open: null })).includes('Neither pane could be read for this span, so the PR pane\'s changes are unknown.'))
  await late.capture.close()
})

// The review's second medium: 300 unchanged collections named to sort first
// put the changed one out of reach, and "and N more" counted wrong.
test('the collections a span draws put flagged and changed ones first, and "and N more" uses the whole counts', () => {
  const names = Array.from({ length: 301 }, (_, i) => `a${String(i).padStart(3, '0')}`)
  const same = counted(coll({ status: 'same', countAfter: 3 }))
  const pr = { ...DIFF(Object.fromEntries([...names.map(n => [n, same]), ['users', counted(coll())]])), collectionsCount: 1_501 }
  const data = sampleData({ session: { complete: true, base: pr, pr, divergence: null, flags: [] } })
  const nodes = dataNodes(data, { span: 'session', view: 'pr', open: 0 })
  const rows = nodes.find(n => n.cls === 'dataTable').children.slice(1).map(r => plain(r.children[0].text))
  assert.equal(rows[0], 'users', 'the changed one first, though it sorts last')
  assert.equal(rows.length, 300)
  const texts = textsOf(nodes)
  assert.ok(texts.includes('and 1201 more collections'), texts.filter(t => /more collections/.test(t)).join('\n'))
  // fields dropped and added past the 50 listed
  const wide = { ...coll({ fieldsDropped: Array.from({ length: 50 }, (_, i) => `f${i}`), fieldsAdded: ['g'] }), counts: { inserted: 0, updated: 0, deleted: 0, fieldsDropped: 60, fieldsAdded: 1 } }
  const w = textsOf(dataNodes(sampleData({ session: { complete: true, base: DIFF({ c: wide }), pr: DIFF({ c: wide }), divergence: null, flags: [] } }), { span: 'session', view: 'pr', open: 0 }))
  assert.ok(w.some(t => t.startsWith('Fields dropped: f0, f1') && t.endsWith(', and 10 more')), w.join('\n'))
  assert.ok(w.includes('Fields added: g'))
})

// The review's low: the Re-baseline sentence on the boot span, and a PR
// pane read a moment ago shown as unreadable.
test('only the session span says a Re-baseline aligns it; a late PR baseline says this snapshot is its baseline', () => {
  const unaligned = { ...sampleData().session, aligned: false, complete: false }
  const session = textsOf(dataNodes(sampleData({ session: unaligned }), { span: 'session', view: 'divergence', open: null }))
  assert.ok(session.some(t => t.endsWith('Re-baseline to compare both from one moment.')))
  const boot = textsOf(dataNodes(sampleData({ boot: unaligned }), { span: 'boot', view: 'divergence', open: null }))
  assert.ok(boot.some(t => t.endsWith('The boot span stays as it was: a Re-baseline aligns only the session span.')), boot.join('\n'))
  assert.equal(boot.some(t => t.includes('Re-baseline to compare')), false)
  const fresh = { complete: false, aligned: true, base: sampleData().session.base, pr: null, divergence: null, flags: [{ collection: null, kind: 'unreadable', severity: 'red', shared: false, pr: 1, base: 0, reason: 'baseline' }], flagsCount: { red: 1, amber: 0 } }
  const texts = textsOf(dataNodes(sampleData({ session: fresh }), { span: 'session', view: 'divergence', open: null }))
  assert.ok(texts.includes('The PR pane\'s baseline is this snapshot: take another to see its changes.'))
  assert.ok(texts.includes('Incomplete: the PR pane\'s baseline is this snapshot, so it has no changes to show yet.'))
  assert.equal(texts.some(t => t.includes('couldn\'t be read')), false)
})

// The engine's and the capture's new flags and states.
test('the panel names the one flag for many collections, an answer too big to list, a collection left out of a snapshot, and caps the problems', () => {
  assert.equal(plain(flagText({ collection: null, kind: 'unverified', severity: 'red', shared: false, pr: 20, base: 0, collections: 20, names: ['aaa01', 'aaa02'] })), '20 collections only the PR pane has: unverified (cut short or not shown), such as aaa01, aaa02')
  assert.equal(plain(flagText({ collection: null, kind: 'unverified', severity: 'red', shared: false, pr: 10, base: 0, collections: 10, names: ['c20'], folded: true })), '10 more collections: unverified (cut short or not shown), such as c20')
  assert.equal(plain(flagText({ collection: null, kind: 'unreadable', reason: 'neither' })), 'Neither pane could be read for this span, so the PR pane\'s changes are unknown.')
  const unlisted = {
    complete: true, aligned: true, unlisted: true, base: null, pr: null, divergence: null,
    flags: [{ collection: null, kind: 'unlisted', severity: 'red', shared: false, pr: 1, base: 0 }, { collection: 'users', kind: 'delete', severity: 'red', shared: false, pr: 15, base: 0 }],
    flagsCount: { red: 2, amber: 0 },
  }
  const u = textsOf(dataNodes(sampleData({ session: unlisted }), { span: 'session', view: 'pr', open: null }))
  assert.ok(u.includes('This span\'s details were too big to list: its counts and first red flags are below, and nothing else.'))
  assert.ok(u.includes('This span\'s details were too big to list: only its counts and first red flags are shown.'))
  assert.ok(u.includes('users: rows deleted, PR 15, base 0'))
  assert.equal(u.some(t => /has no data for this span|couldn't be read/.test(t)), false, u.join('\n'))
  // a collection a snapshot may have left out
  const omitted = counted(coll({ status: 'unknown', omitted: 'before', truncated: true, countBefore: null, countAfter: 2 }))
  const o = textsOf(dataNodes(sampleData({ session: { complete: true, base: DIFF({ users: omitted }), pr: DIFF({ users: omitted }), divergence: null, flags: [] } }), { span: 'session', view: 'pr', open: null }))
  assert.ok(o.includes('unknown (left out of a snapshot)'))
  assert.ok(o.includes('? → 2'))
  // at most 20 problems a pane, and how many more
  const many = Array.from({ length: 30 }, (_, i) => `p${i}: rows must be an array`)
  const p = textsOf(dataNodes(sampleData({ problems: { base: [], pr: many }, problemsCount: { base: 0, pr: 80 } }), { span: 'session', view: 'divergence', open: null }))
  assert.equal(p.filter(t => /^PR: p\d+: rows must be an array$/.test(t)).length, 20)
  assert.ok(p.includes('PR: and 60 more problems'))
})

// Mutants round 3 let live.
test('no "and 0 more flags"; a full 8-hex text digest at a cut is hidden; one baseline time when the panes\' are equal', () => {
  const nodes = dataNodes(sampleData(), { span: 'session', view: 'divergence', open: null })
  assert.equal(textsOf(nodes).some(t => /more flags/.test(t)), false)
  const shown = plain(cellText({ t: 'long', s: '{"pad":"aaa","note":"[text with a secret-looking key, 40 characters, 1a2b3c4d', len: 300, d: 'ff' }))
  assert.doesNotMatch(shown, /1a2b3c4d/)
  const texts = textsOf(dataNodes(sampleData({ baselineAt: 5_000, baselines: { base: 5_000, pr: 5_000 } }), { span: 'session', view: 'divergence', open: null }))
  assert.ok(texts.some(t => /^baseline \d\d:\d\d:\d\d · compared /.test(t)), texts.join('\n'))
})
