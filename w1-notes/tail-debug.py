import shutil, sys
p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/forwarder.test.mjs'
bak = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/fwdtest.bak'
if sys.argv[1] == 'on':
    shutil.copy(p, bak)
    s = open(p).read()
    s = s.replace("  // read, a little at a time, until nothing is queued anywhere on the way:", "  console.error('phase1', sent, Date.now())\n  // read, a little at a time, until nothing is queued anywhere on the way:")
    s = s.replace("  // then a little at a time, until a few bytes are queued", "  console.error('phase2', received, Date.now())\n  // then a little at a time, until a few bytes are queued")
    s = s.replace("  assert.ok(serverSide().writableLength < 16 * 1024, String(serverSide().writableLength))", "  console.error('phase3', sent, Date.now())\n  assert.ok(serverSide().writableLength < 16 * 1024, String(serverSide().writableLength))")
    open(p, 'w').write(s)
else:
    shutil.copy(bak, p)
print(sys.argv[1])
