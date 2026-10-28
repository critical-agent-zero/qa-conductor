p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/test/data-capture.test.mjs'
s = open(p).read()
s = s.replace("          if (snapshot) return snapshot(paneRef.role, s)", "          if (snapshot) return snapshot(paneRef.role, s, stores)", 1)
s = s.replace("// reads it as the inspector would. `snapshot(role, signal)` may stand in.", "// reads it as the inspector would. `snapshot(role, signal, stores)` may stand in.", 1)
reps = [
    ("""    snapshot: (role) => {
      call++
      if (role === 'pr' && failPrReady && call > 2) throw new Error('timed out')
      return { collections: structuredClone(stores[role]) }
    },""",
     """    snapshot: (role, _, st) => {
      call++
      if (role === 'pr' && failPrReady && call > 2) throw new Error('timed out')
      return { collections: structuredClone(st[role]) }
    },"""),
    ("""    snapshot: role => { if (role === 'pr' && failPr) throw new Error('busy'); return { collections: structuredClone(stores[role]) } },""",
     """    snapshot: (role, _, st) => { if (role === 'pr' && failPr) throw new Error('busy'); return { collections: structuredClone(st[role]) } },"""),
    ("""  const { capture, signal, stores } = await readyCapture({ snapshot: role => ({ collections: structuredClone(stores[role]) }) })""",
     """  const { capture, signal, stores } = await readyCapture({ snapshot: (role, _, st) => ({ collections: structuredClone(st[role]) }) })"""),
]
for a, b in reps:
    assert a in s, a[:60]
    s = s.replace(a, b, 1)
# the late-baseline test also checks the seeded reads worked
s = s.replace("""  stores.pr.saved_carts.rows = [] // the PR's migration
  await capture.ready({ signal })""", """  assert.deepEqual(capture.view({}).errors.boot, { base: null, pr: null }, 'both seeded reads worked')
  stores.pr.saved_carts.rows = [] // the PR's migration
  await capture.ready({ signal })""", 1)
open(p, 'w').write(s)
print('ok')
