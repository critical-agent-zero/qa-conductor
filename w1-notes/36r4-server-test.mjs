
// #36's round 4: the capture's work runs on the event loop that serves the
// panes. The cells a snapshot keeps bound it, so another route still
// answers soon while a Snapshot now reads a PR store of 2 million cells.
test('another route answers within a bound while a Snapshot now reads a PR store of 2 million cells', { timeout: 60_000 }, async () => {
  const table = v => ({ key: ['i'], fields: ['i', 'v'], rows: Array.from({ length: 10_000 }, (_, i) => ({ i, v })) })
  const tables = v => Object.fromEntries(Array.from({ length: 100 }, (_, t) => [`t${String(t).padStart(3, '0')}`, table(v)]))
  const big = { 0: tables(0), 1: tables(1) }
  let phase = 'seed'
  const inspector = {
    async open({ paneRef }) {
      return { snapshot: async () => ({ collections: paneRef.role === 'pr' && phase !== 'seed' ? big[phase] : { users: { key: ['id'], rows: [{ id: 1 }] } } }) }
    },
  }
  const w = makeWorld({ inspector })
  try {
    const ports = await allPorts(w.c)
    phase = 0
    await api(ports.harness, 'POST', '/api/session', { pr: 7 })
    await waitFor(async () => (await api(ports.harness, 'GET', '/api/state')).status === 'ready', 30_000)
    phase = 1
    const snapshot = raw(ports.harness, { method: 'POST', path: '/qa/api/data/snapshot', headers: JSON_TYPE, body: '{}' })
    await new Promise(resolve => setTimeout(resolve, 50))
    const sent = performance.now()
    await api(ports.harness, 'GET', '/api/state')
    const waited = performance.now() - sent
    assert.equal((await snapshot).status, 200)
    // without the bound, the read and the answer took about 5 s here
    assert.ok(waited < 3_000, `${Math.round(waited)} ms`)
  } finally { w.c.stop() }
})
