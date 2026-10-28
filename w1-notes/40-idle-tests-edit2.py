p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/forwarder.test.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b)


sub("""  setImmediate(() => { w.socket.bytesRead += 1000 })
  await sleep(60)
  assert.deepEqual(w.cuts, [], 'spared')
  await sleep(500)
  assert.equal(w.cuts.length, 1, 'and cut once nothing moves')
})
""", """  setImmediate(() => { w.socket.bytesRead += 1000 })
  // past the grace (it ends 100 ms after the late timer), before the next look
  await sleep(160)
  assert.deepEqual(w.cuts, [], 'spared')
  await sleep(500)
  assert.equal(w.cuts.length, 1, 'and cut once nothing moves')
})

test('idleTimer: a socket gone during the grace isn\\'t cut', async (t) => {
  const w = watched(100)
  t.after(w.stop)
  await sleep(150)
  w.socket.destroyed = true
  await sleep(250)
  assert.deepEqual(w.cuts, [])
})
""")
open(p, 'w').write(s)
print('ok')
