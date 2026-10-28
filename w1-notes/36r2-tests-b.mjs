
// A diff lists at most 1,000 collections, those that changed first.
test('an answer lists at most 1,000 collections a diff, the changed ones first, with the whole count', async () => {
  const names = Array.from({ length: 1_200 }, (_, i) => `c${String(i).padStart(4, '0')}`)
  let state = Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1 }] }]))
  const { capture, signal } = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }) })
  await capture.ready({ signal })
  // the last five change
  state = { ...state, ...Object.fromEntries(names.slice(-5).map(n => [n, { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }])) }
  await capture.snapshot()
  const pr = capture.view({}).session.pr
  assert.equal(Object.keys(pr.collections).length, 1_000)
  assert.equal(pr.collectionsCount, 1_200)
  for (const name of names.slice(-5)) assert.equal(pr.collections[name].status, 'changed', name)
  const div = capture.view({}).session.divergence
  assert.deepEqual([Object.keys(div.collections).length, div.collectionsCount], [1_000, 1_200])
  assert.equal(div.collections.c1199.status, 'both')
})

test('flagsCount counts each severity, whatever is listed', async () => {
  const { capture, signal, stores } = await readyCapture()
  await capture.ready({ signal })
  stores.base.saved_carts.rows = []
  stores.pr.saved_carts.rows = []
  await capture.snapshot()
  assert.deepEqual(capture.view({ isolation: { verdict: 'isolated' } }).session.flagsCount, { red: 0, amber: 2 })
  assert.deepEqual(capture.view({}).session.flagsCount, { red: 2, amber: 0 })
})
