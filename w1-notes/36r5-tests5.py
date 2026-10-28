R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'test/data-capture.test.mjs'
s = open(R + P).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b)


# the amber test: a budget the PR's own tables overrun, and the base list
sub("""  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }), capture: { limits: { maxCollections: 2_000 } } })
  pr = { users: people(20), ...ownTables(1_000, 2) }
  await capture.ready({ signal })
  const cleared = people(20)""",
    """  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }), capture: { limits: { maxCollections: 2_000 }, viewBytes: 200_000 } })
  pr = { users: people(20), ...ownTables(1_000, 2) }
  await capture.ready({ signal })
  const cleared = people(20)""")
sub("""  assert.equal(Object.keys(s.pr.collections)[0], 'users')
  assert.equal(Object.keys(s.divergence.collections)[0], 'users')
})""",
    """  assert.equal(Object.keys(s.pr.collections)[0], 'users')
  assert.equal(Object.keys(s.divergence.collections)[0], 'users')
  // the base pane's users, unchanged there, still comes before the PR's
  // own red tables, which overrun the budget
  assert.deepEqual(Object.keys(s.base.collections), ['users'])
  assert.equal(s.pr.cut, true)
})""")

# the s2 test: the same shape with the wide tables seeded
sub("""  assert.equal(Object.keys(s.pr.collections).length < 46, true)
  // a list that listed everything says no cut, though another was cut
  assert.equal(s.base.cut, undefined)
})""",
    """  assert.equal(Object.keys(s.pr.collections).length < 46, true)
  // a list that listed everything says no cut, though another was cut
  assert.equal(s.base.cut, undefined)

  // the same with the wide tables seeded (zNN: after users by name), all
  // in the first tier: users's entry in each list still comes before any
  // wide table's, though its first flag isn't the first
  const seededWide = Object.fromEntries(Array.from({ length: 45 }, (_, t) => [`z${String(t).padStart(2, '0')}`, { key: ['id'], rows: wide }]))
  const base2 = { users: users(20), ...seededWide }
  let pr2 = base2
  const two = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base2 : pr2) }), capture: { viewBytes: 200_000 } })
  await two.capture.ready({ signal: two.signal })
  pr2 = { users: users(5), ...Object.fromEntries(Object.keys(seededWide).map(n => [n, { key: ['id'], rows: [] }])) }
  await two.capture.snapshot()
  const s2 = two.capture.view({}).session
  for (const list of ['pr', 'divergence', 'base']) assert.equal(Object.keys(s2[list].collections)[0], 'users', list)
  assert.equal(s2.pr.cut, true)
})""")

# the key-lost test: a seeded collection the PR cut short (left out) before a lost key
sub("""  assert.ok(boot.flags.some(f => f.kind === 'key-lost'))
  assert.deepEqual([boot.flags[0].collection, boot.flags[0].kind], ['users', 'delete'])
  assert.equal(Object.keys(boot.pr.collections)[0], 'users')
})""",
    """  assert.ok(boot.flags.some(f => f.kind === 'key-lost'))
  assert.deepEqual([boot.flags[0].collection, boot.flags[0].kind], ['users', 'delete'])
  assert.equal(Object.keys(boot.pr.collections)[0], 'users')

  // a seeded collection the PR's snapshot cut short where the base pane's
  // isn't stands with what loses rows too: before a lost key
  const small = { key: ['id'], rows: [{ id: 1, uuid: 'a' }, { id: 2, uuid: 'a' }] }
  const base2 = { aa: small, zz: small }
  let pr2 = base2
  const two = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base2 : pr2) }), capture: { limits: { maxRows: 5 } } })
  pr2 = { aa: { ...small, key: ['uuid'] }, zz: { key: ['id'], rows: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, uuid: 'a' })) } }
  await two.capture.ready({ signal: two.signal })
  const flags2 = two.capture.view({}).boot.flags.map(f => [f.collection, f.kind])
  assert.deepEqual(flags2, [['zz', 'unverified'], ['aa', 'key-lost']])
})""")
open(R + P, 'w').write(s)
print('ok')
