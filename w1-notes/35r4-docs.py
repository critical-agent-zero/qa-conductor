R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:100], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""  - at most `LIMITS.maxRows` (10,000) rows a collection, `LIMITS.maxBytes` (32 MB) in all and `LIMITS.maxCollections` (1,000) collections. The bytes are shared fairly:""",
     """  - at most `LIMITS.maxRows` (10,000) rows a collection, `LIMITS.maxBytes` (32 MB) and `LIMITS.maxCells` (500,000 cells, a row's fields) in all, and `LIMITS.maxCollections` (1,000) collections. The cells bound the work: masking a snapshot, and diffing and flagging two, takes time in proportion to their cells, on the conductor's event loop. The bytes and cells are shared fairly:"""),
    ("""  - **The order:** `red` first. Within a severity, the collections the base pane has come before those only the PR pane has, then the destructive kinds before `unverified` and `cleared`, then by collection, kind and field. So a cap on a list keeps what matters to the base pane's data.""",
     """  - **The order:** `red` first. Within a severity, the collections the base pane has come before those only the PR pane has. Then the kinds that lose data (`delete`, `emptied`, `dropped`, `key-lost`) come before `column-dropped` and `mass-change`, and those before `unverified` and `cleared`. Then by collection, kind and field. So a cap on a list keeps what matters to the base pane's data, and many renamed columns can't push a delete out."""),
])
edit('CHANGELOG.md', [
    ("""  - **What a snapshot keeps:** each collection's rows, key and true count, at most 10,000 rows a collection, 32 MB in all, shared fairly,""",
     """  - **What a snapshot keeps:** each collection's rows, key and true count, at most 10,000 rows a collection, 32 MB and 500,000 cells in all (which bounds the work on the event loop), shared fairly,"""),
    ("""Red flags come first, and among them the base pane's collections, and the destructive kinds before `unverified`.""",
     """Red flags come first, and among them the base pane's collections, then what loses data (deletes, emptying, drops, a lost key), then column and mass-change flags, then `unverified`."""),
])
print('ok')
