R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
p = R + 'README.md'
s = open(p).read()
rep = [
    ("    - a number: seven digits or more anywhere in the segment, with at most one separator between any two (a phone, a card, an account like `ACCT9876543210`);",
     "    - a number: seven digits or more anywhere in the segment, with at most three separators between any two (a phone, a card, an account like `ACCT9876543210`);"),
    ("    - At most one of each kind a pane every 100 ms, from a budget of 2,000 a pane that refills one a second. So PR code can use up its own pane's marks for a while, never the base pane's.",
     "    - At most one of each kind a pane every 100 ms, from a budget of 2,000 a pane that refills one a second. So PR code can use up its own pane's marks for as long as it keeps posting, never the base pane's. Each pane keeps its last 8,000 marks."),
    ("    - Marks group both panes' requests, since a mirrored action is reported by the pane it happened in only. A request goes under its own pane's mark when one is that close.",
     "    - Marks group both panes' requests, since a mirrored action is reported by the pane it happened in only. The reader groups them ([HTTP API](#http-api-harness-port))."),
]
for a, b in rep:
    assert a in s, a[:60]
    s = s.replace(a, b, 1)
start = s.index("| `GET /api/actions?after=N&limit=M` |")
end = s.index("\n", start)
row = ("| `GET /api/actions?after=N&limit=M` | the ready session's [action log](#security): its requests and marks after sequence number `N` (default `0`), "
       "`{active, log, seq, more, requests, marks, dropped, refused, marksDropped}`. One sequence numbers requests and marks alike, in the order they were recorded "
       "(a request when it ended). A read gives the next of them, at most `M` together (default and most 2,000), in that order; `more` says there are others, "
       "and `seq` is where to read on from. So a reader that reads on until `more` is `false` has had everything, once. `log` names the log: a new session's starts "
       "its `seq` again, so when `log` changes, or `active` is `false`, discard what you have and read from `0`. A request is "
       "`{seq, pane, at, method, path, status, ms, bytes, aborted}`, and a mark `{seq, pane, at, type}`. **Grouping is the reader's:** a request most likely came "
       "from, of the marks no more than 300 ms after it started (`at`), its own pane's nearest within 300 ms either side, else the nearest; the earlier on a tie; "
       "none before any mark (the landing). A mark can come after the requests it set off, so a reader groups again as marks come. Each pane keeps its last 5,000 "
       "requests, counting those `dropped`, and its last 8,000 marks. `refused` counts what its guards refused, by reason. With no session ready, `active` is "
       "`false`, `log` is `null` and the lists are empty. Reading it is no activity |")
s = s[:start] + row + s[end:]
open(p, 'w').write(s)

p = R + 'CHANGELOG.md'
s = open(p).read()
a = "    - routes: `GET /api/actions?after=N&limit=M`, read in pages of at most 2,000 new and 2,000 regrouped requests, each naming its `log`, and `POST /api/actions/mark`;"
b = "    - routes: `GET /api/actions?after=N&limit=M`, which reads requests and marks in one sequence, at most 2,000 at a time, each read naming its `log`, and `POST /api/actions/mark`;"
assert a in s
s = s.replace(a, b, 1)
open(p, 'w').write(s)
print('ok')
