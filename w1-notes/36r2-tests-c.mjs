
// The flags listed are the red first: 600 amber ones before a red one in
// name order still leave the red one listed.
test('a span lists its red flags first, so the cap never hides one behind amber ones', async () => {
  const names = Array.from({ length: 600 }, (_, i) => `a${String(i).padStart(3, '0')}`)
  const two = { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }
  const one = { key: ['id'], rows: [{ id: 1 }] }
  let base = { ...Object.fromEntries(names.map(n => [n, two])), z: two }
  let pr = base
  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }) })
  await capture.ready({ signal })
  // both panes delete a row of each a…; the PR alone one of z
  base = { ...Object.fromEntries(names.map(n => [n, one])), z: two }
  pr = { ...Object.fromEntries(names.map(n => [n, one])), z: one }
  await capture.snapshot()
  const s = capture.view({ isolation: { verdict: 'isolated' } }).session
  assert.deepEqual(s.flagsCount, { red: 1, amber: 600 })
  assert.equal(s.flags.length, 500)
  assert.deepEqual([s.flags[0].collection, s.flags[0].severity], ['z', 'red'])
})
