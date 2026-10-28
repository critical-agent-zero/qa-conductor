R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'test/data-capture.test.mjs'
s = open(R + P).read()

start = s.index("// The review's surviving mutants.\n")
end = s.index("// The nit: the reason when only the PR's read failed")
new = r"""// The review's surviving mutants, M11 and M24.
test('the fallback lists red flags only; a collection whose key alone was lost ranks with changed rows', async () => {
  // M11: a span with red and amber flags lists only the red in its fallback
  const two = rows => ({ orders: { key: ['id'], rows }, carts: { key: ['id'], rows } })
  let prState = two([{ id: 1 }, { id: 2 }])
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

  // M24: in the base pane, zz lost its key, its rows the same: it moved,
  // so it ranks before aa, whose only mark is the PR's amber flag
  const keyed = { zz: { key: ['id'], rows: [{ id: 1, uuid: 'a' }, { id: 2, uuid: 'a' }] }, aa: { key: ['id'], rows: [{ id: 1, email: 'x@example.org' }] } }
  let b = keyed
  let p = keyed
  const lost = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? b : p) }) })
  await lost.capture.ready({ signal: lost.signal })
  b = { ...keyed, zz: { ...keyed.zz, key: ['uuid'] } }
  p = { ...keyed, aa: { key: ['id'], rows: [{ id: 1, email: null }] } }
  await lost.capture.snapshot()
  const s = lost.capture.view({}).session
  assert.equal(s.base.collections.zz.keyLost, true)
  assert.deepEqual(s.flags.map(f => [f.collection, f.kind]), [['aa', 'cleared']])
  assert.deepEqual(Object.keys(s.base.collections), ['zz', 'aa'])
})

// The review's N12, and its N4 and N7 (an entry of the divergence not
// charged, or skipped where listing should stop): at every budget from
// small to whole, each list is a prefix of its order, a list that stops
// short says cut (and one that doesn't, doesn't), and the span stays
// within its share.
test('at every budget, each list lists a prefix of its order, says cut exactly when short, and the span stays within its share', async () => {
  // names long and short in turn, so a long one that doesn't fit is
  // followed by a short one that would
  const names = Array.from({ length: 30 }, (_, i) => `c${String(i).padStart(2, '0')}${i % 2 ? 'x'.repeat(150) : ''}`)
  const three = names.map(n => [n, { key: ['id'], rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }])
  const before = Object.fromEntries(three)
  // the PR inserts a row in each; the base pane changes nothing
  const after = Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }]))
  const at = async viewBytes => {
    let pr = before
    const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? before : pr) }), capture: { viewBytes } })
    await capture.ready({ signal })
    pr = after
    await capture.snapshot()
    return capture.view({}).session
  }
  const whole = await at(10_000_000)
  const order = Object.fromEntries(['pr', 'divergence', 'base'].map(l => [l, Object.keys(whole[l].collections)]))
  // N12: equal ranks go by name
  assert.deepEqual(order.pr, [...names].sort())
  assert.deepEqual(order.base, [...names].sort())
  const size = span => Buffer.byteLength(JSON.stringify({ flags: span.flags, base: span.base, pr: span.pr, divergence: span.divergence }))
  let cuts = 0
  for (let viewBytes = 1_000; viewBytes < 40_000; viewBytes += 43) {
    const s = await at(viewBytes)
    for (const l of ['pr', 'divergence', 'base']) {
      const listed = Object.keys(s[l].collections)
      assert.deepEqual(listed, order[l].slice(0, listed.length), `${l} at ${viewBytes}`)
      assert.equal(s[l].cut === true, listed.length < order[l].length, `${l} at ${viewBytes}`)
      if (s[l].cut) cuts++
    }
    assert.ok(size(s) <= Math.floor(viewBytes / 2) + 500, `${size(s)} bytes at ${viewBytes}`)
  }
  assert.ok(cuts > 100, String(cuts))
})

"""
s = s[:start] + new + s[end:]
open(R + P, 'w').write(s)
print('ok')
