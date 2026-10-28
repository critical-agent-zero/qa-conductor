p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/test/action-log.test.mjs'
s = open(p).read()
start = s.index("// A request belongs to the mark nearest it in time among those that came no")
s = s[:start] + open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/34r3-tests.mjs').read()
# the budget test's title and comment, per the nit
s = s.replace("// PR code can post bridge messages: it can use up the PR pane's marks for a\n// while, never the base pane's, and never for the rest of the session.",
              "// PR code can post bridge messages: it can use up the PR pane's marks for as\n// long as it keeps posting, never the base pane's, and a pause refills them.")
s = s.replace("using up the PR pane\\'s leaves the base pane\\'s alone, and lasts a while only", "using up the PR pane\\'s leaves the base pane\\'s alone, and a pause refills it")
# table rows from the review
anchor = "    ['/k/ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF', '/k/:token'],"
assert anchor in s
rows = anchor + """
    // up to three separators between digits
    ['/phone/555%20-%20123%20-%204567', '/phone/:number'],
    ['/card/4111 - 1111 - 1111 - 1111', '/card/:number'],
    ['/ssn/123 - 45 - 6789', '/ssn/:number'],
    ['/phone/555..123..4567', '/phone/:number'],
    ['/phone/555--123--4567', '/phone/:number'],
    ['/phone/(555)%20%20123%20%204567', '/phone/:number'],
    // one escape that doesn't decode stops only itself
    ['/u/a%EF%BC%A0b.co%', '/u/:email'],
    ['/u/a%EF%B9%ABb.co%', '/u/:email'],
    ['/x/token%3Dabc123%', '/x/token=…'],
    ['/x/token%3Dabc%25', '/x/token=…'],
    ['/u/bob%2540gmail.com%', '/u/:email'],
    ['/x/a%3D%E0', '/x/…=…'],"""
s = s.replace(anchor, rows, 1)
open(p, 'w').write(s)
print('ok')
