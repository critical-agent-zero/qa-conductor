
// --- Round 2 of #37's review --------------------------------------------------------

// The review's high: the PR makes its own read fail (a lock), and its
// changes vanished from the badge, the announcement and the list. Through
// the real capture: the span carries a red `unreadable` flag, which the
// badge counts and the panel draws.
test('a PR pane whose read fails or hangs shows as unknown changes: counted in the badge, never "No destructive change."', async () => {
  const { createDataCapture } = await import('../lib/data-capture.mjs')
  let hang = false
  const users = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `u${i}` }))
  const stores = { base: users, pr: users }
  const capture = createDataCapture({
    inspector: { open: ({ paneRef }) => ({ snapshot: () => (hang && paneRef.role === 'pr' ? new Promise(() => {}) : { collections: { users: { key: ['id'], rows: structuredClone(stores[paneRef.role]) } } }) }) },
    rules: validateRules({}),
    limits: { timeoutMs: 30 },
  })
  const signal = new AbortController().signal
  for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
  await capture.ready({ signal })
  stores.pr = users.slice(15)
  await capture.snapshot()
  assert.equal(dataBadge(capture.view({})), 2, 'a delete and a mass change')
  hang = true
  await capture.snapshot()
  const data = capture.view({ isolation: { verdict: 'isolated' } })
  assert.equal(dataBadge(data), 1)
  const texts = textsOf(dataNodes(data, { span: 'session', view: 'divergence', open: null }))
  assert.equal(texts.includes('No destructive change.'), false)
  assert.ok(texts.includes('The PR pane couldn\'t be read for this span, so its changes are unknown.'), texts.join('\n'))
  assert.ok(texts.includes('Incomplete: the PR pane has no data for this span, so its changes are unknown.'))
  assert.equal(texts.some(t => /PR pane has no data.*excuse/.test(t)), false, 'the PR pane missing is not about excusing')
  await capture.close()
})

test('Incomplete says why, per pane: a base pane missing excuses nothing, a PR pane missing is unknown, windows that differ excuse nothing', () => {
  const ui = { span: 'session', view: 'divergence', open: null }
  const noBase = sampleData()
  noBase.session = { ...noBase.session, complete: false, base: null, divergence: null }
  assert.ok(textsOf(dataNodes(noBase, ui)).includes('Incomplete: the BASE pane has no data for this span, so nothing it did can excuse a change.'))
  const unaligned = sampleData()
  unaligned.session = { ...unaligned.session, complete: false, aligned: false }
  unaligned.baselines = { base: Date.UTC(2026, 9, 15, 12, 0, 0), pr: Date.UTC(2026, 9, 15, 12, 5, 0) }
  const texts = textsOf(dataNodes(unaligned, ui))
  assert.ok(texts.includes('Incomplete: the panes\' windows differ (a pane\'s ready read failed, and a later snapshot is its baseline), so nothing in the base pane can excuse a change. Re-baseline to compare both from one moment.'), texts.join('\n'))
  assert.ok(texts.some(t => /^baselines BASE \d\d:\d\d:\d\d, PR \d\d:\d\d:\d\d · compared /.test(t)), texts.join('\n'))
})

// The badge counts every red flag of a span, the ones the answer lists and
// the rest (flagsCount), and the panel says how many more there are.
test('the badge and the list use flagsCount, so the flags an answer leaves out still count', () => {
  const data = sampleData()
  data.session = { ...data.session, flagsCount: { red: 900, amber: 40 } }
  assert.equal(dataBadge(data), 900)
  const texts = textsOf(dataNodes(data, { span: 'session', view: 'divergence', open: null }))
  assert.ok(texts.includes('and 939 more flags'), texts.join('\n'))
})

// U+2028 and U+2029 end an isolate in some renderers: shown as codes too.
test('a line or paragraph separator in PR text shows as its code', () => {
  assert.equal(drawnText('a\u2029b\u2028c'), 'a\\u{2029}b\\u{2028}c')
  assert.equal(plain(cellText('x\u2029y')), '"x\\u{2029}y"')
})

// A cell the engine cut at 200 characters may end in part of a digest.
test('a value cut at 200 characters shows no part of a secret\'s digest', () => {
  for (const tail of ['[secret e8586848', '[secret e858', '[secret ', '[text with a secret-looking key, 40 characters, 1a2b']) {
    const shown = plain(cellText({ t: 'long', s: `{"pad":"aaa","api_key":"${tail}`, len: 300, d: 'ff' }))
    assert.doesNotMatch(shown, /e858|1a2b/, tail)
    assert.match(shown, /\[secret|\[text with a secret-looking key, 40 characters/, tail)
  }
})

// Mutants the round-1 tests let live.
test('a flag\'s class is red or amber, whatever its severity says; grouping\'s window and ties hold at their edges', () => {
  const nodes = dataNodes(sampleData({ session: { ...sampleData().session, flags: [{ collection: 'c', kind: 'delete', severity: 'red" onclick="x', pr: 1, base: 0 }] } }), { span: 'session', view: 'divergence', open: null })
  const list = nodes.find(n => n.cls === 'flags')
  assert.equal(list.children[0].cls, 'flag amber')
  // none of its own pane within 300 ms; the one after is more than 300 ms
  // after the request, so the earlier one, however far, is nearest
  assert.equal(markOf({ pane: 'base', at: 1_000 }, [mark(1, 'pr', 600), mark(2, 'pr', 1_350)]), 1)
  // equal times: the lower seq, whatever order the marks came in
  const s = mergeActions(actionsFresh(), answer({ seq: 9, marks: [mark(5, 'pr', 1_000), mark(3, 'pr', 1_000)], requests: [req(9, 'base', '/tie', 1_000)] }))
  const texts = textsOf(actionsNodes(s)).map(t => t.replace(/^\d\d:\d\d:\d\d /, ''))
  assert.deepEqual(texts.slice(0, 3), ['click, reported by the PR pane', 'BASE GET /tie 200 5 ms', 'click, reported by the PR pane'])
})

test('a secret field\'s name, a session error, a problem and a JSON cell are each set apart', () => {
  const data = sampleData({
    errors: { boot: { base: null, pr: null }, session: { base: 'err\u202Eor', pr: null } },
    problems: { base: ['pro\u202Eblem'], pr: [] },
  })
  const name = Object.keys(data.session.pr.collections)[0]
  data.session.pr.collections[name].updated = [{ key: '[2]', fields: [{ field: 'tok\u05D0en', before: { t: 'secret', d: 'a' }, after: { t: 'secret', d: 'b' } }] }]
  data.session.pr.collections[name].deleted = [{ key: '[1]', row: { doc: { t: 'json', s: '{"\u05D0":1}' } } }]
  const raws = rawTextsOf(dataNodes(data, { span: 'session', view: 'pr', open: 0 }))
  for (const want of ['\u2068tok\u05D0en\u2069: (secret, changed)', '\u2068err\\u{202E}or\u2069', '\u2068pro\\u{202E}blem\u2069', '\u2068{"\u05D0":1}\u2069']) {
    assert.ok(raws.some(t => t.includes(want)), `${JSON.stringify(want)}\n${raws.join('\n')}`)
  }
})

// A data read that fails after its session ended draws nothing; showing the
// session view again never starts a second poll.
test('a failed data read for a session that ended draws nothing, and the Actions panel never polls twice', async () => {
  let state = { status: 'ready', pr: 7, panes: PANES, data: { available: true }, startedAt: 1 }
  let release
  const gate = new Promise(resolve => { release = resolve })
  const b = fakeBrowser({
    hash: '#/pr/7', stored: 'tok-1',
    elements: { prList: fakeList() },
    routes: {
      'GET /qa/api/state': () => ({ body: state }),
      'POST /qa/api/pane-entry': entryRoute,
      'GET /qa/api/prs': { body: { prs: [], session: null } },
      'GET /qa/api/data': { status: 500, body: { error: 'boom' }, hold: gate },
      'GET /qa/api/actions': { body: answer() },
    },
  })
  await b.settle()
  state = { status: 'idle' }
  b.intervals.find(i => i.ms === 60_000).fn()
  await b.settle()
  const from = b.log.length
  release()
  await b.settle()
  assert.equal(b.log.slice(from).some(e => e[0] === 'set' && (e[1] === 'dataStatus' || e[1] === 'dataBody')), false)

  state = { status: 'ready', pr: 7, panes: PANES, startedAt: 2 }
  const c = fakeBrowser({
    hash: '#/pr/7', stored: 'tok-1',
    routes: { 'GET /qa/api/state': () => ({ body: state }), 'POST /qa/api/pane-entry': entryRoute, 'GET /qa/api/actions': { body: answer() } },
  })
  await c.settle()
  c.byId('actionsBtn').onclick()
  // the session view is drawn again (the hash said so again)
  const [, , onHash] = c.listeners.find(([name, type]) => name === 'window' && type === 'hashchange')
  onHash()
  await c.settle()
  assert.equal(c.intervals.filter(i => i.ms === 2000 && !i.cleared).length, 1)
})
