R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""  - at most `LIMITS.maxRows` (10,000) rows a collection, `LIMITS.maxBytes` (32 MB) and `LIMITS.maxCells` (500,000 cells, a row's fields) in all, and `LIMITS.maxCollections` (1,000) collections. The cells bound the work: masking a snapshot, and diffing and flagging two, takes time in proportion to their cells, on the conductor's event loop. The bytes and cells are shared fairly: the collections with the fewest rows go first, each with at most an equal share of what is left, so one big collection, a PR's padding say, can't starve the others. A collection cut short is `truncated`, and only its count is compared;""",
     """  - at most `LIMITS.maxRows` (10,000) rows a collection, `LIMITS.maxBytes` (32 MB) in all and `LIMITS.maxCollections` (1,000) collections. The bytes are shared fairly: the collections with the fewest rows go first, each with at most an equal share of what is left, so one big collection, a PR's padding say, can't starve the others. A collection cut short is `truncated`, and only its count is compared. The bytes are the kept rows' JSON: they bound neither the heap the rows take nor the work of reading them ([Known limits](#known-limits));"""),
    ("""  - it returns `{collections, problems, omitted}`. `omitted` counts the collections given but not kept (left out, or unreadable), or is `null` when the snapshot couldn't be read at all;""",
     """  - it returns `{collections, problems, omitted}`. `omitted` counts the collections given but not kept (left out, or unreadable), or is `null` when the snapshot couldn't be read at all. Those left out for a name over 200 characters don't count: no collection the diff sees can be one of them;"""),
    ("""      - `pin` as a word of its own (`pin`, `user_pin`).""",
     """      - `pin`, `pw` and `psk` as words of their own (`pin`, `user_pin`, `user_pw`, `wifi-psk`), and `auth` or `_auth` as the whole name (Docker's and npm's base64 `user:password`)."""),
    ("""So is the value of a name and value pair whose name looks secret: an object of at most six keys with `name`, `key`, `field` or `k` for the name and `value`, `val` or `v` for the value, in any case (`{name: 'Authorization', value}`, AWS's `{Name, Value}`).""",
     """So is every value of a name and value pair whose name looks secret: `name` or `key` with `value`, all lower case or all capitalized, whatever else the object holds (`{name: 'Authorization', value}`, a HAR cookie, AWS's `{Name, Value}`, an SSM Parameter); and the looser spellings, `field` or `k` for the name and `val` or `v` for the value, in any case, in an object of at most six keys."""),
    ("""A key counts at a word's start, quoted or not (an escaped or HTML-escaped quote too), or in brackets, then `:` or `=` (`"password": …`, `\\"password\\": …`, `&quot;password&quot;: …`, `api_key=…`, `user[password]=…`), and as a tag, with a namespace or attributes (`<password>`, `<wsse:Password Type="…">`). The first 256 KB are read, in time linear in them: a cell shows at most its first 200 characters;""",
     """A key counts at a word's start or right after a percent-escape, quoted or not (an escaped quote, one HTML-escaped in any case, one percent-encoded, or a backtick), or in brackets, then up to 32 spaces and `:` or `=` or their percent-encodings (`"password": …`, `\\"password\\": …`, `&quot;password&quot;: …`, `` `password` = … ``, `api_key=…`, `user[password]=…`, `password%3D…`), and as a tag, with a namespace or attributes (`<password>`, `<wsse:Password Type="…">`). So do a command-line flag whose name looks secret (`--password …`, `--db-token=…`), a MySQL client's `-p<password>`, and a PEM private key. The first 256 KB are read: a cell shows at most its first 200 characters;"""),
    ("""    - in text, a URL's password (`postgres://app:<secret>@db`, with an empty user too, and up to the last `@` before the host) or a token alone as its userinfo (16 characters or more), and the value after `Bearer`, `Basic` or `Token`, in any case, are replaced by a digest, the rest kept. That value must look like a token, with a digit in it or 16 characters, so prose such as "Basic introduction" is kept;""",
     """    - in text, these are replaced by a digest, the rest kept:
      - a URL's password (`postgres://app:<secret>@db`, with an empty user too, and up to the last `@` before the host), or a token alone as its userinfo (16 characters or more). The user too when it looks like a token, or has an empty password or GitHub's `x-oauth-basic` beside it (`https://<token>:x-oauth-basic@github.com`);
      - the value after `Bearer`, `Basic` or `Token`, in any case, when it looks like a token: a digit in it, or 16 characters, or for `Basic`, base64 (`dXNlcjpwYXNz`). So prose such as "Basic introduction" is kept;
      - a Go DSN's password (`user:<secret>@tcp(…)`), and a JWT;
      - the `value` of an element whose `key`, `name`, `id` or `type` looks secret (`<add key="DbPassword" value="…"/>`, `<input type="password" value="…">`);
    - **what masking misses.** It is best-effort: a PR controls its own data, and can always hide a value from a name or a shape. It matters for the seeded data the Data panel shows. In text, a secret with no key, scheme or shape listed above shows: SQL's `INSERT … VALUES` by position, a password alone on a line, a `-p` flag outside a MySQL client, a URL password with a raw `/`. So does a field whose name `SECRET_NAME` doesn't match, such as `key` alone, which is often a row's own key. Name such fields in `classify`;"""),
    ("""- **`flagChanges(baseDiff, prDiff, rules, {trusted})`**: the PR pane's destructive changes, each `{collection, kind, severity, shared, pr, base, field?}`.""",
     """- **`flagChanges(baseDiff, prDiff, rules, {trusted})`**: the PR pane's destructive changes, each `{collection, kind, severity, shared, pr, base, field?, count?, fields?}`."""),
    ("""    - `column-dropped`: a declared field gone, one flag per field;""",
     """    - `column-dropped`: declared fields gone, one flag a collection, with their number in `count` and the first five in `fields`. It is shared only when the base dropped every one of them;"""),
    ("""Then by collection, kind and field. So a cap on a list keeps what matters to the base pane's data, and many renamed columns can't push a delete out.""",
     """Then by collection, kind and field. So a cap on a list keeps what matters to the base pane's data, and a PR's padding, such as many dropped columns, can't push a delete out."""),
    ("""- **Linux and macOS only, and no TypeScript declarations yet** ([Requirements](#requirements)).""",
     """- **Hostile PR data and the conductor's responsiveness.** The data checks' engine runs on the conductor's event loop. PR-controlled data within the limits can stall the panes, the harness and every request for seconds, and for minutes in the worst shapes measured (32 MB of text lines that look like JSON but aren't took about 4 minutes):
  - masking works through the raw data a PR's store holds, not just what is kept: every cell is read, and text that looks like JSON is parsed, before the budget is checked;
  - the 32 MB budget counts the kept rows' JSON, not the heap they take: 1,000 collections of 10,000 empty rows, 29 MB of JSON, took about 600 MB of heap for one snapshot, and the data answer keeps several;
  - this is accepted. PR authors have passed the trust gate ([Security](#security)), and a stall shows no masked value and hides no destructive change: it only slows that PR's review. Tearing the session down ends it.
- **Linux and macOS only, and no TypeScript declarations yet** ([Requirements](#requirements))."""),
])

edit('CHANGELOG.md', [
    ("""each at most 10,000 rows a collection, 32 MB and 500,000 cells in all (which bounds the work on the event loop), shared fairly, and 1,000 collections""",
     """each at most 10,000 rows a collection, 32 MB in all, shared fairly, and 1,000 collections"""),
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
