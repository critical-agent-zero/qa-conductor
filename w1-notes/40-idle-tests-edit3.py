p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/forwarder.test.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b)


sub("""  await sleep(50)
  // the loop stalls past the timer's deadline; what moved meanwhile shows
  // only after the timer has fired, as I/O does
  const until = Date.now() + 200""", """  await sleep(50)
  // the loop stalls past the timer's deadline, outside the timers phase as
  // a long callback would; the next turn runs the late timer first, and
  // what moved meanwhile shows only after it, as I/O does
  await new Promise(resolve => setImmediate(resolve))
  const until = Date.now() + 200""")
open(p, 'w').write(s)
print('ok')
