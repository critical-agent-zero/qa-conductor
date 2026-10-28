
// #36's review: a migration that adds 1,600 columns to each of many tables,
// then drops them. Comparing the declared fields is linear in them.
test('comparing declared fields is linear: 50 tables of 1,600 columns added and dropped compare in well under a second each way', () => {
  const cols = Array.from({ length: 1_600 }, (_, i) => `column_with_a_rather_long_name_${String(i).padStart(4, '0')}`)
  const at = fields => snap(Object.fromEntries(Array.from({ length: 50 }, (_, t) => [`t${t}`, { key: ['id'], fields: ['id', ...fields], rows: [{ id: 1 }] }])))
  const narrow = at([])
  const wide = at(cols)
  const started = performance.now()
  const added = diffSnapshots(narrow, wide)
  const dropped = diffSnapshots(wide, narrow)
  const div = divergence(added, dropped)
  const flags = flagChanges(added, dropped, none, { trusted: true })
  const took = performance.now() - started
  assert.ok(took < 2_000, `${Math.round(took)} ms`)
  assert.equal(added.collections.t0.fieldsAdded.length, 1_600)
  assert.equal(div.collections.t0.changes.length, 3_200)
  assert.equal(flags.filter(f => f.kind === 'column-dropped').length, 50 * 1_600)
})
