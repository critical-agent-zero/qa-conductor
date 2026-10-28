R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""      - `pin`, `pw` and `psk` as words of their own (`pin`, `user_pin`, `user_pw`, `wifi-psk`), and `auth` or `_auth` as the whole name (Docker's and npm's base64 `user:password`).""",
     """      - `pin`, `pw` and `psk` as words of their own (`pin`, `user_pin`, `user_pw`, `wifi-psk`), and `auth` or `_auth` as the whole name (Docker's and npm's base64 `user:password`), in text after an escape too (`%26pin%3D…`, `\\n_auth=…`)."""),
    ("""So is every value of a name and value pair whose name looks secret: `name` or `key` with `value`, all lower case or all capitalized, whatever else the object holds (`{name: 'Authorization', value}`, a HAR cookie, AWS's `{Name, Value}`, an SSM Parameter); and the looser spellings, `field` or `k` for the name and `val` or `v` for the value, in any case, in an object of at most six keys.""",
     """So is every value of a name and value pair whose name looks secret: `name` or `key` with `value`, all lower case or all capitalized, whatever else the object holds (`{name: 'Authorization', value}`, a HAR cookie, AWS's `{Name, Value}`, an SSM Parameter); and the looser spellings, `field` or `k` for the name and `val` or `v` for the value, in any case, in an object of at most six keys. Any of its name-like keys may name it (`{key: 'mail.smtp', name: 'Password', value}`). A row shaped as such a pair, as in a settings table (`{id, key: 'smtp_password', value}`), has its value fields masked the same way."""),
    ("""A key counts at a word's start, quoted or not""",
     """A key counts at a word's start, or right after a percent-escape (`x%3dpassword=…`), quoted or not"""),
    ("""and as a tag, with a namespace or attributes (`<password>`, `<wsse:Password Type="…">`). So do a command-line flag whose name looks secret (`--password …`, `--db-token=…`), a MySQL client's `-p<password>`, and a PEM private key.""",
     """and as a tag, with a namespace, whatever its attributes hold (`<password>`, `<wsse:Password Type="…">`, `<password hint="a<b">`). So do a command-line flag whose name looks secret (`--password …`, `--db-token=…`), a MySQL client's `-p<password>`, and a PEM or PGP private key."""),
    ("""      - a Go DSN's password (`user:<secret>@tcp(…)`), and a JWT;
      - the `value` of an element whose `key`, `name`, `id` or `type` looks secret (`<add key="DbPassword" value="…"/>`, `<input type="password" value="…">`);""",
     """      - a Go DSN's password, up to its last `@` (`user:<secret>@tcp(…)`, `@tcp6(…)`, `@unix(…)`, `@cloudsql(…)`, any network, or `@/`), and a JWT;
      - the `value` of an element whose `key`, `name`, `id` or `type` looks secret, quoted either way or not (`<add key="DbPassword" value="…"/>`, `<input type=password value=…>`);"""),
    ("""In text, a secret with no key, scheme or shape listed above shows: SQL's `INSERT … VALUES` by position, a password alone on a line, a `-p` flag outside a MySQL client, a URL password with a raw `/`. So does a field whose name `SECRET_NAME` doesn't match, such as `key` alone, which is often a row's own key. Name such fields in `classify`;""",
     """In text, a secret with no key, scheme or shape listed above shows: SQL's `INSERT … VALUES` by position, a password alone on a line, a `-p` flag outside a MySQL client, a URL password with a raw `/`, a DSN password with a `:` in it, an element's value holding a `>`. So does a field whose name `SECRET_NAME` doesn't match, such as `key` alone, which is often a row's own key, and a pair under other names, such as WordPress's `{option_name, option_value}`. Name such fields in `classify`;"""),
    ("""per collection, `{status, key, inserted, updated, deleted, fieldsDropped, fieldsAdded, countBefore, countAfter, truncated, keyLost, omitted}`.""",
     """per collection, `{status, key, inserted, updated, deleted, fieldsDropped, fieldsAdded, countBefore, countAfter, truncated, keyLost, omitted, fieldsBefore}`. `fieldsBefore` is the before snapshot's declared fields, or `null`."""),
    ("""    - `column-dropped`: declared fields gone, one flag a collection, with their number in `count` and the first five in `fields`. It is shared only when the base dropped every one of them;""",
     """    - `column-dropped`: declared fields gone, one flag a collection, with their number in `count` and the first five in `fields`: first those the base pane's before snapshot declares too (the seeded ones, how many in `seeded`), then the PR's own. So padding columns the PR added can't hide a seeded one it dropped. It is shared only when the base dropped every one of them;"""),
    ("""Then the kinds that lose data (`delete`, `emptied`, `dropped`, `key-lost`) come before `column-dropped` and `mass-change`, and those before `unverified` and `cleared`.""",
     """Then what loses rows, a collection or its key (`delete`, `emptied`, `dropped`, `key-lost`, and the `unverified` flag of a collection the PR pane's snapshots may have left out, which can hide a drop or a wipe) comes before `column-dropped` and `mass-change`, and those before other `unverified` flags and `cleared`."""),
])

edit('CHANGELOG.md', [
    ("""A collection's dropped columns are one flag, with their number and the first five.""",
     """A collection's dropped columns are one flag, with their number and the first five, the seeded ones first."""),
    ("""Red flags come first, and among them the base pane's collections, then what loses data (deletes, emptying, drops, a lost key), then column and mass-change flags, then `unverified`.""",
     """Red flags come first, and among them the base pane's collections, then what loses rows, a collection or its key (deletes, emptying, drops, a lost key, and a collection the PR's snapshots may have left out), then column and mass-change flags, then other `unverified` flags."""),
])
print('ok')
