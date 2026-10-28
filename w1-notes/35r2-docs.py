R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:90])
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""  - at most `LIMITS.maxRows` (10,000) rows a collection, `LIMITS.maxBytes` (32 MB) in all and `LIMITS.maxCollections` (1,000) collections. The bytes are shared fairly: the collections with the fewest rows go first, each with at most an equal share of what is left, so one big collection, a PR's padding say, can't starve the others. A collection cut short is `truncated`, and only its count is compared;""",
     """  - at most `LIMITS.maxRows` (10,000) rows a collection, `LIMITS.maxBytes` (32 MB) in all and `LIMITS.maxCollections` (1,000) collections. The bytes are shared fairly: the collections with the fewest rows go first, each with at most an equal share of what is left, so one big collection, a PR's padding say, can't starve the others. A collection cut short is `truncated`, and only its count is compared;
  - past `maxCollections`, the collections with the most rows are kept, so many small ones can't push a real one out. The rest are kept as their counts alone (`truncated`, with no rows), up to ten times as many, and only past those is one left out. `problems` names both;"""),
    ("""    - **a secret** is `{t: 'secret', d}`: only whether it changed shows. That is a field whose name matches `SECRET_NAME`, or one `classify` marks `secret`. `SECRET_NAME` matches `pass`, `pwd`, `secret`, `token`, `salt`, `hash`, `otp`, `api_key`, `access_key`, `signing_key`, `client_key`, `private`, `session`, `card`, `cvv`, `cvc`, `ssn`, `iban`, `authorization`, `bearer`, `jwt`, `cookie`, `credential`, `signature`, `dsn`, `database_url` and `pin`. A secret-looking name stays secret whatever `classify` says;""",
     """    - **a secret** is `{t: 'secret', d}`: only whether it changed shows. That is a field whose name matches `SECRET_NAME`, or one `classify` marks `secret`. `SECRET_NAME` matches, in any case:
      - `pass`, `pwd`, `secret`, `token`, `salt`, `hash`, `otp`, `private`, `session`, `card`, `cvv`, `cvc`, `ssn`, `iban`, `authorization`, `bearer`, `jwt`, `cookie`, `credential`, `signature`, `dsn`, `mnemonic`, anywhere in the name;
      - `api_key`, `access_key`, `signing_key`, `client_key`, `encryption_key`, `master_key`, `ssh_key`, `database_url`, `mongo_url`, `redis_url`, `amqp_url`, `postgres_url`, `mysql_url`, `connection_string`, `seed_phrase`, `recovery_code`, `backup_code` and `pin_code`, with `_`, `-` or nothing between the words (`apiKey`, `api-key`), and `uri` for `url`;
      - `pin` as a word of its own (`pin`, `user_pin`).

      A secret-looking name stays secret whatever `classify` says;"""),
    ("""    - a value under a secret-looking key inside JSON is masked too, with a digest of its collection's and field's. So is JSON held in a string inside JSON, up to three deep, and NDJSON line by line. Bytes inside JSON show only their length, and a `Set` or `Map` its entries;
    - text that isn't JSON, or is over 256 KB, but shows a secret-looking key (`"password": …`, `api_key=…`) is masked whole: `[text with a secret-looking key, <length>, <digest>]`;""",
     """    - a value under a secret-looking key inside JSON is masked too, with a digest of its collection's and field's. So is the value of a name and value pair whose name looks secret (`{name: 'Authorization', value}`, or `key` for `name`), and the string after a secret-looking one in a list of strings (Node's `rawHeaders`). JSON held in a string inside JSON is read too, up to three deep, and so is JSON encoded twice, and NDJSON line by line. Bytes inside JSON show only their length, and a `Set` or `Map` its entries;
    - text that isn't JSON, or is over 256 KB, but shows a secret-looking key is masked whole: `[text with a secret-looking key, <length>, <digest>]`. A key counts at a word's start, quoted or not (an escaped quote too), or in brackets, then `:` or `=` (`"password": …`, `\\"password\\": …`, `api_key=…`, `user[password]=…`), and as a tag (`<password>`). The first 256 KB are read: a cell shows at most its first 200 characters;
    - in text, a URL's password (`postgres://app:<secret>@db`) and the value after `Bearer`, `Basic` or `Token` are replaced by a digest, the rest kept;"""),
    ("""    - a value that isn't set (`null`, `''`, `[]` or `{}`) is kept as it is, whatever its field, so clearing a secret shows.""",
     """    - a value that isn't set (`null`, `''`, `[]`, `{}`, or an empty `Set` or `Map`) is kept as it is, whatever its field, so clearing a secret shows. A `Set` or `Map` with entries is masked like any other value."""),
    ("""  - The collection's `status` sums its changes up: `same` when there are none, or `unknown` for a truncated collection whose counts show nothing, or one truncated in one pane only, whose count can't be set beside the other's rows.""",
     """  - The collection's `status` sums its changes up: `same` when there are none, or `unknown` for a truncated collection whose counts show nothing, one truncated in one pane only, whose count can't be set beside the other's rows, or one the PR pane's diff lacks while the base pane's has it."""),
    ("""    - `unverified`: a collection the PR pane's snapshot cut short where the base pane's didn't, or a cut-short one whose count changed. What happened past the cut can't be seen, so it is never taken for nothing;""",
     """    - `unverified`: a collection the PR pane's snapshot cut short where the base pane's didn't, a cut-short one whose count changed, or one the base pane's diff has and the PR pane's lacks. What happened past the cut can't be seen, so it is never taken for nothing. One cut short in both panes with no change in count is listed too, `amber`;"""),
    ("""  - **Severity:** `amber` when the base made the same change (`shared`) and `trusted` is `true`, else `red`. The same change means the same rows (by key, or as a multiset without one), with the same fields changed, the same field, or for two cut-short collections the same change in count.""",
     """  - **Severity:** `amber` when the base made the same change (`shared`) and `trusted` is `true`, else `red`. The same change means the same rows (by key, or as a multiset without one), with the same fields changed to the same values, the same field, or for two cut-short collections the same change in count."""),
])

edit('CHANGELOG.md', [
    ("""  - **What a snapshot keeps:** each collection's rows, key and true count, at most 10,000 rows a collection, 32 MB in all, shared fairly, and 1,000 collections.""",
     """  - **What a snapshot keeps:** each collection's rows, key and true count, at most 10,000 rows a collection, 32 MB in all, shared fairly, and 1,000 collections, those with the most rows. Up to ten times as many more are kept as their counts alone, flagged `unverified`, and only past those is one left out, by name in `problems`."""),
    ("""  - **Masking:** a secret-looking or `secret` field keeps only a digest, and a `pii` one a fingerprint, its type and its length, as HMACs under a key made for the session. JSON keeps no value under a secret-looking key, in JSON held in strings too (three deep) and NDJSON, and text that shows a secret-looking key is masked whole.""",
     """  - **Masking:** a secret-looking or `secret` field keeps only a digest, and a `pii` one a fingerprint, its type and its length, as HMACs under a key made for the session; a `Set` or `Map` too. JSON keeps no value under a secret-looking key, nor in a name and value pair or a header list, in JSON held in strings (three deep), JSON encoded twice and NDJSON too. Text that shows a secret-looking key, quoted, escaped, in brackets or as a tag, is masked whole, and a URL's password or a `Bearer` value in text is replaced by a digest. The text scan is linear."""),
    ("""    - which of the PR's changes are destructive: red unless the base made the same change (the same rows, the same fields), then amber. A collection a PR cut short where the base's wasn't is flagged `unverified`.""",
     """    - which of the PR's changes are destructive: red unless the base made the same change (the same rows, the same fields, to the same values), then amber. A collection a PR cut short where the base's wasn't, or that the PR's snapshots don't show while the base's do, is flagged `unverified`."""),
])
print('ok')
