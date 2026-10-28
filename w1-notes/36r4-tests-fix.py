p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/test/data-capture.test.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""  const text = '数据'.repeat(100)
  let state = { t: { key: ['id'], rows: [] } }
  const { capture, signal } = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }), capture: { viewBytes: 200_000 } })
  state = { t: { key: ['id'], rows: Array.from({ length: 2_000 }, (_, id) => ({ id, text })) } }
  await capture.ready({ signal })
  const json = capture.viewJson({})
  assert.ok(Buffer.byteLength(json) < 200_000 + 20_000, `${Buffer.byteLength(json)} bytes`)""", """  // 60 tables of 50 rows of 200 characters, three bytes each in UTF-8: far
  // more than a span's 100,000 bytes, whatever is counted
  const text = '数据'.repeat(100)
  const tables = rows => Object.fromEntries(Array.from({ length: 60 }, (_, t) => [`t${String(t).padStart(2, '0')}`, { key: ['id'], rows }]))
  let state = tables([])
  const { capture, signal } = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }), capture: { viewBytes: 200_000 } })
  state = tables(Array.from({ length: 50 }, (_, id) => ({ id, text })))
  await capture.ready({ signal })
  const json = capture.viewJson({})
  assert.ok(Buffer.byteLength(json) < 200_000 + 20_000, `${Buffer.byteLength(json)} bytes`)""")
sub("""  // an empty added collection ranks before unchanged ones past 1,000 (M18),
  // and a collection whose key alone was lost, or whose fields alone
  // changed, ranks as changed (M24, M25)
  let st = { ...padding, zz_keyed: { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }, zz_fields: { key: ['id'], fields: ['id', 'a'], rows: [{ id: 1 }] } }
  const ranks = await readyCapture({ snapshot: () => ({ collections: structuredClone(st) }), capture: { limits: { maxCollections: 2_000 } } })
  await ranks.capture.ready({ signal: ranks.signal })
  st = { ...padding, zz_added: { key: ['id'], rows: [] }, zz_keyed: { key: ['id'], rows: [{ id: 1 }, { id: 1 }] }, zz_fields: { key: ['id'], fields: ['id', 'b'], rows: [{ id: 1 }] } }
  await ranks.capture.snapshot()
  const r = ranks.capture.view({ isolation: { verdict: 'isolated' } }).session.pr.collections
  for (const name of ['zz_added', 'zz_keyed', 'zz_fields']) assert.ok(Object.hasOwn(r, name), name)
})""", """  // an empty added collection ranks before unchanged ones past 1,000 (M18)
  let st = { ...padding }
  const ranks = await readyCapture({ snapshot: () => ({ collections: structuredClone(st) }), capture: { limits: { maxCollections: 2_000 } } })
  await ranks.capture.ready({ signal: ranks.signal })
  st = { ...padding, zz_added: { key: ['id'], rows: [] } }
  await ranks.capture.snapshot()
  assert.ok(Object.hasOwn(ranks.capture.view({ isolation: { verdict: 'isolated' } }).session.pr.collections, 'zz_added'))
  // past 1,050 collections with only an amber flag (cut short alike in both
  // panes), a collection whose fields alone changed (M24, M25), and one
  // whose divergence moved only in its counts (M22, M23), rank as changed
  const amber = Object.fromEntries(Array.from({ length: 1_050 }, (_, i) => [`a${String(i).padStart(4, '0')}`, { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }]))
  let at = { ...amber, zz_fields: { key: ['id'], fields: ['id'], rows: [{ id: 1 }] }, zz_bag: { key: null, rows: [] } }
  const moved = await readyCapture({ snapshot: () => ({ collections: structuredClone(at) }), capture: { limits: { maxCollections: 2_000, maxRows: 1 } } })
  await moved.capture.ready({ signal: moved.signal })
  at = { ...amber, zz_fields: { key: ['id'], fields: ['id', 'b'], rows: [{ id: 1 }] }, zz_bag: { key: null, rows: [{ v: 1 }] } }
  await moved.capture.snapshot()
  const m = moved.capture.view({ isolation: { verdict: 'isolated' } }).session
  assert.equal(m.flagsCount.amber, 1_050)
  assert.ok(Object.hasOwn(m.pr.collections, 'zz_fields'), 'fields alone changed')
  assert.ok(Object.hasOwn(m.divergence.collections, 'zz_bag'), 'counts alone moved')
})""")
open(p, 'w').write(s)
print('ok')
