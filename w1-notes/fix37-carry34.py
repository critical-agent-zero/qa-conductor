R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
s = ''


def edit(path, pairs):
    global s
    s = open(R + path).read()
    for a, b in pairs:
        assert a in s, (path, a[:80])
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/action-log.mjs', [
    ("""// Seven digits or more, each joined to the next by at most three
// separators: `555 - 123 - 4567` and `(555)  123  4567` too. Masking a
// little too much is fine here.
const DIGIT_RUN = /\\p{Nd}(?:[^\\p{L}\\p{Nd}]{0,3}\\p{Nd}){6,}/u""",
     """// Seven digits or more, each joined to the next by at most four
// separators: `555 - 123 - 4567`, `(555)  123  4567` and `555 -- 123 -- 4567`
// too. Masking a little too much is fine here.
const DIGIT_RUN = /\\p{Nd}(?:[^\\p{L}\\p{Nd}]{0,4}\\p{Nd}){6,}/u"""),
])

edit('test/action-log.test.mjs', [
    ("""    // up to three separators between digits
""", """    // up to four separators between digits
"""),
    ("""    ['/phone/(555)%20%20123%20%204567', '/phone/:number'],
""", """    ['/phone/(555)%20%20123%20%204567', '/phone/:number'],
    ['/phone/555 -- 123 -- 4567', '/phone/:number'],
    ['/phone/555....123....4567', '/phone/:number'],
    ['/v/1.....2.....3.....4.....5.....6.....7', '/v/1.....2.....3.....4.....5.....6.....7'], // five: kept
"""),
    ("""    ['/x/a%3D%E0', '/x/…=…'],
""", """    ['/x/a%3D%E0', '/x/…=…'],
    // the raw checks, where a bad escape in the run stops it decoding
    ['/u/jos%E9%40x.io', '/u/:email'],
    ['/u/jos%E9%2540x.io', '/u/:email'],
    ['/x/a%253D%E0', '/x/…=…'],
    ['/x/k%3d%E0', '/x/…=…'],
    ['/u/a%ef%bc%a0b', '/u/:email'],
"""),
    ("""  assert.equal(log.read(0, { limit: 9_999 }).requests.length + log.read(0, { limit: 9_999 }).marks.length, 2_000)
""", """  assert.equal(log.read(0, { limit: 9_999 }).requests.length + log.read(0, { limit: 9_999 }).marks.length, 2_000)
  // a limit that isn't one is the most
  for (const limit of [0, -1]) assert.equal(log.read(0, { limit }).requests.length + log.read(0, { limit }).marks.length, 2_000, String(limit))
"""),
])

edit('test/server.test.mjs', [
    ("test('GET /api/actions reads on from `after`, at most `limit` requests at a time', async () => {",
     "test('GET /api/actions reads on from `after`, at most `limit` requests and marks at a time', async () => {"),
])

edit('test/harness.test.mjs', [
    ("""  click() // 50 ms after the page started
  perf += 150
  wall -= 3_600_000
  click() // 150 ms on, the wall clock an hour back
  perf += 50
  click() // 50 ms on: held back
  await b.settle()
  assert.equal(marks().length, 2)
""", """  click() // 50 ms after the page started
  assert.equal(marks().length, 1, 'the first click is posted at once')
  perf += 150
  wall -= 3_600_000
  click() // 150 ms on, the wall clock an hour back
  assert.equal(marks().length, 2, 'the second, 150 ms on, is posted')
  perf += 50
  click() // 50 ms on: held back
  assert.equal(marks().length, 2, 'the third, 50 ms on, is not')
  perf += 50
  click() // exactly 100 ms after the second
  await b.settle()
  assert.equal(marks().length, 3, 'the fourth, 100 ms after the second, is')
"""),
])
print('ok')
