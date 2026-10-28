R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('CHANGELOG.md', [
    ("""at most 10,000 rows a collection, 32 MB and 500,000 cells in all (which bounds the work on the event loop), shared fairly, and 1,000 collections""",
     """at most 10,000 rows a collection, 32 MB in all, shared fairly, and 1,000 collections"""),
    ("""A snapshot says how many it left out, and a collection missing from one that left some out is `unknown`, never added or dropped.""",
     """A snapshot says how many it left out (not counting names over 200 characters), and a collection missing from one that left some out is `unknown`, never added or dropped."""),
    ("""JSON keeps no value under a secret-looking key, nor in a name and value pair (`name`, `Name`, `key`, `k` and the like) or a header list,""",
     """JSON keeps no value under a secret-looking key, nor in a name and value pair (`name`, `Name`, `key`, `k` and the like; any size with `name` or `key` and `value`, as a HAR cookie or an SSM Parameter) or a header list,"""),
    ("""Text that shows a secret-looking key, quoted, escaped (HTML-escaped too), in brackets or as a tag (with a namespace or attributes), is masked whole. In text, a URL's password or token, and a `Bearer`, `Basic` or `Token` value that looks like a token, in any case, are replaced by a digest. The text scan is linear, runs of backslashes included.""",
     """Text that shows a secret-looking key, quoted, escaped (HTML-escaped or percent-encoded too, or in backticks), in brackets or as a tag (with a namespace or attributes), a command-line flag, a MySQL `-p` or a PEM private key, is masked whole. In text, a URL's password or token (and a user that is one), a `Bearer`, `Basic` or `Token` value that looks like a token, in any case, a Go DSN's password, a JWT, and the value of an element named as a secret are replaced by a digest. What it misses is listed. The key scan reads runs of backslashes once, and a tag's attributes stop at the next `<`."""),
    ("""Red flags come first, and among them the base pane's collections, then what loses data (deletes, emptying, drops, a lost key), then column and mass-change flags, then `unverified`.""",
     """A collection's dropped columns are one flag, with their number and the first five. Red flags come first, and among them the base pane's collections, then what loses data (deletes, emptying, drops, a lost key), then column and mass-change flags, then `unverified`."""),
])
print('ok')
