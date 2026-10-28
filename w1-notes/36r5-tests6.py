R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'test/data-capture.test.mjs'
s = open(R + P).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b)


sub("""  let prState = two([{ id: 1 }, { id: 2 }])
  let baseState = prState
  const mixed = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? baseState : prState) }) })
  await mixed.capture.ready({ signal: mixed.signal })
  baseState = two([{ id: 1 }])
  prState = { ...two([{ id: 1 }]), own: { key: ['id'], rows: [] } }
  await mixed.capture.snapshot()
  const fb = mixed.capture.view({ isolation: { verdict: 'isolated' } }, { lists: false }).session
  assert.ok(fb.flagsCount.amber > 0, JSON.stringify(fb.flagsCount))
  assert.ok(fb.flags.length > 1)
  assert.ok(fb.flags.every(f => f.severity === 'red'))
""", """  let baseState = two([{ id: 1 }, { id: 2 }])
  let prState = { ...baseState, own: { key: ['id'], rows: [{ id: 1 }, { id: 2 }] } }
  const mixed = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? baseState : prState) }) })
  await mixed.capture.ready({ signal: mixed.signal })
  // the same deletes in both panes (amber, trusted), and one of the PR's own (red)
  baseState = two([{ id: 1 }])
  prState = { ...two([{ id: 1 }]), own: { key: ['id'], rows: [{ id: 1 }] } }
  await mixed.capture.snapshot()
  const fb = mixed.capture.view({ isolation: { verdict: 'isolated' } }, { lists: false }).session
  assert.deepEqual(fb.flagsCount, { red: 2, amber: 2 })
  assert.deepEqual(fb.flags.map(f => [f.collection, f.kind]), [[null, 'unlisted'], ['own', 'delete']])
""")
# the sweep: fewer, wider steps
sub("for (let viewBytes = 1_000; viewBytes < 40_000; viewBytes += 43) {", "for (let viewBytes = 2_000; viewBytes < 34_000; viewBytes += 71) {")
open(R + P, 'w').write(s)
print('ok')
