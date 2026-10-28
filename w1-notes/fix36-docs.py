R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
p = R + 'README.md'
s = open(p).read()


def sub(a, b):
    global s
    assert a in s, a[:70]
    s = s.replace(a, b, 1)


sub("  - **Failures:** an `open` or `snapshot` that throws, returns nothing useful, or takes longer than `limits.timeoutMs` (30 s) fails nothing. Its pane shows why it has no data, and a probe that comes too late is closed unused.",
    "  - **Failures:** an `open` or `snapshot` that throws, returns nothing useful, or takes longer than `limits.timeoutMs` (30 s) fails nothing. Its pane shows why it has no data, and a probe that comes too late is closed unused. The `signal` each call gets aborts at its timeout too, so a call that heeds it stops. A hanging inspector can add up to 150 s to a boot: an open and a seeded read per pane, one after the other, then the ready reads together.")
sub("- **`ready`:** once both panes are signed in, before the reviewer's first request. It is the baseline.",
    "- **`ready`:** once both panes are signed in, before the reviewer's first request. It is the baseline. A pane whose ready read failed keeps its `seeded` snapshot, and its first later snapshot is its baseline, so its boot span still shows; why its ready read failed stays in `errors.boot`.")
sub("- **`now`:** on **Snapshot now** (`POST /api/data/snapshot`). The baseline to `now` is the **session** span: what the reviewer's actions did.",
    "- **`now`:** on **Snapshot now** (`POST /api/data/snapshot`). The baseline to `now` is the **session** span: what the reviewer's actions did. A pane whose read failed has no session span, rather than an old one.")
sub("**Re-baseline** (`{rebaseline: true}`) makes now the baseline, after a manual sign-in, say. `GET /api/data` gives both spans: each pane's diff, their divergence, and the PR's flags, `trusted` or `advisory` by the session's isolation verdict. It never reaches the event stream, a log or GitHub. The event stream says only `{kind: 'capture', pane, phase, ok}`.",
    "**Re-baseline** (`{rebaseline: true}`) makes now the baseline, after a manual sign-in, say: both panes, or, when either read fails, neither. `GET /api/data` gives both spans: each pane's diff, their divergence, and the PR's flags, `trusted` or `advisory` by the session's isolation verdict. It never reaches the event stream, a log or GitHub. The event stream says only `{kind: 'capture', pane, phase, ok}`, for the `seeded` and `ready` phases.")
start = s.index("| `GET /api/data` |")
end = s.index("\n", start)
s = s[:start] + ("| `GET /api/data` | the ready session's [data checks](#data-checks): `{available, active, trust, baselineAt, rebaselined, comparedAt, errors, problems, boot, session}`. "
                 "`available` is `false` with no inspector, and `active` is `false` with no session ready. `boot` and `session` are each `{complete, base, pr, divergence, flags}`, or `null` before a snapshot. "
                 "`base` and `pr` are each pane's diff, `null` for a pane with none, and `complete` is `false` then. A diff lists at most 50 rows of each kind a collection, and divergence 50 changes, with whole `counts` "
                 "(`changesCount`); an answer lists at most about 4 MB of rows in all. `errors` says, per pane, why one has no data: `boot` for the open, seeded and ready reads, which a later success never erases, and "
                 "`session` for the latest read. Values are masked where they may be secret. The answer is built once for each state and trust. `no-store`, and reading it is no activity |") + s[end:]
open(p, 'w').write(s)

p = R + 'CHANGELOG.md'
s = open(p).read()
sub("  - **It never fails a boot:** an inspector that throws, hangs past 30 s or returns nonsense leaves its pane without data and says why.",
    "  - **It never fails a boot:** an inspector that throws, hangs past 30 s or returns nonsense leaves its pane without data and says why, and a call that times out is told to stop. A pane whose ready read failed keeps its seeded snapshot until a later one gives it a baseline.")
open(p, 'w').write(s)
print('ok')
