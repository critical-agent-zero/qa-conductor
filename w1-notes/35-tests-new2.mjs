
// Mutants of this round's own code that the tests above let live.
test('a collection a snapshot may have left out: no delete read from its unknown count, never shared, no counts guessed, unknown even beside one the base added', () => {
  const people = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const pad = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`aaa${String(i).padStart(2, '0')}`, people(3)]))
  const limits = { maxCollections: 2 }
  // left out of Sn: an unverified, and no delete read from a count it hasn't
  const kept = snap({ users: people(2) }, {}, limits)
  const lost = diffSnapshots(kept, snap({ ...pad, users: people(2) }, {}, limits))
  assert.deepEqual(flagChanges(diffSnapshots(kept, kept), lost, none, { trusted: true }).filter(f => f.collection === 'users').map(f => [f.kind, f.severity]), [['unverified', 'red']])
  // both panes alike: still never shared, so red even trusted
  const s1 = snap({ ...pad, users: people(2) }, {}, limits)
  const both = diffSnapshots(s1, snap({ users: people(2) }, {}, limits))
  const flag = flagChanges(both, both, none, { trusted: true }).find(f => f.collection === 'users')
  assert.deepEqual([flag.kind, flag.severity, flag.shared], ['unverified', 'red', false])
  // divergence guesses no counts for it, and says unknown even where the
  // base pane added the collection
  const fresh = snap({}, {}, limits)
  const baseAdded = diffSnapshots(fresh, snap({ users: people(2) }, {}, limits))
  assert.equal(baseAdded.collections.users.status, 'added')
  const v = divergence(baseAdded, both).collections.users
  assert.deepEqual([v.status, v.counts.pr], ['unknown', { inserted: 0, updated: 0, deleted: 0 }])
})

test('a scheme\'s value with a digit in it is masked from 8 characters; one without, from 16', () => {
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, a: 'with Bearer abc12345 then', b: 'with Token abcdefgh then', c: 'with Basic abcdefghijklmnop then' }] } }).collections.c.rows
  assert.match(row.a, /^with Bearer \[secret [0-9a-f]{8}\] then$/)
  assert.equal(row.b, 'with Token abcdefgh then')
  assert.match(row.c, /^with Basic \[secret [0-9a-f]{8}\] then$/)
})
