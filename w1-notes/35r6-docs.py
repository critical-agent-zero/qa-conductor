R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/data-diff.mjs', [
    ("""// - column-dropped: declared fields gone, one flag per collection, with
//   `count` and the first five in `fields`, so many can't push another
//   flag out of a capped list;""",
     """// - column-dropped: declared fields gone, one flag per collection, with
//   `count`, and the first five in `fields`: first those the base pane's
//   before snapshot declares too (by name; `seeded` counts them), then the
//   PR's own. So many can't push another flag out of a capped list, nor
//   padding columns hide a seeded one;"""),
    ("""// The order: red first; within a severity, collections the base pane has
// before those only the PR pane has; then the kinds that lose data (delete,
// emptied, dropped, key-lost), then column-dropped and mass-change, then
// unverified and cleared; then by collection, kind and field. So a
// collection's dropped columns, one flag, or many mass changes can't push a
// delete out of a capped list.""",
     """// The order: red first; within a severity, collections the base pane has
// before those only the PR pane has; then what loses rows, a collection or
// its key (delete, emptied, dropped, key-lost, and the unverified flag of a
// base-pane collection the PR's snapshots may have left out, or cut short
// where the base pane's didn't), then column-dropped and mass-change, then
// other unverified flags and cleared; then by collection, kind and field.
// So a collection's dropped columns, one flag, or many mass changes can't
// push a delete out of a capped list."""),
])

edit('README.md', [
    ("""In text, a secret with no key, scheme or shape listed above shows: SQL's `INSERT … VALUES` by position, a password alone on a line, a `-p` flag outside a MySQL client, a URL password with a raw `/`, a DSN password with a `:` in it, an element's value holding a `>`. So does a field whose name `SECRET_NAME` doesn't match, such as `key` alone, which is often a row's own key, and a pair under other names, such as WordPress's `{option_name, option_value}`. Name such fields in `classify`;""",
     """In text, a secret with no key, scheme or shape listed above shows:
      - SQL's `INSERT … VALUES` by position, and a password alone on a line;
      - a `-p` flag outside a MySQL client;
      - a URL or DSN password with a raw `/` in it;
      - an element's value when any of its attributes holds a `<` or `>`;
      - a tag that is escaped (`&lt;password&gt;`, `%3Cpassword%3E`, `\\u003cpassword\\u003e`), a closing tag alone, and `<!…` or `<?…`;
      - a key encoded twice (`%2522password%2522`), after a smart quote, or after a `\\u` or `\\x` escape;
      - "Token" followed by a word of under 16 letters and no digit, which reads as prose.

      So does a field whose name `SECRET_NAME` doesn't match, such as `key` alone, which is often a row's own key. So does a pair under other names, such as `setting` or WordPress's `{option_name, option_value}`, or a loose or all-caps spelling (`KEY`, `k`) in a row of more than six fields. Name such fields in `classify`. `test/data-masking-corpus.test.mjs` holds every shape a review has reported, and these as its known misses;"""),
    ("""the PR pane's destructive changes, each `{collection, kind, severity, shared, pr, base, field?, count?, fields?}`.""",
     """the PR pane's destructive changes, each `{collection, kind, severity, shared, pr, base, field?, count?, seeded?, fields?, collections?, names?}`."""),
    ("""first those the base pane's before snapshot declares too (the seeded ones, how many in `seeded`), then the PR's own.""",
     """first those the base pane's before snapshot declares too, matched by name (the seeded ones, how many in `seeded`), then the PR's own. A seeded column the PR renamed before the span's first snapshot counts as its own here; the boot span shows the rename."""),
    ("""  - the 32 MB budget counts the kept rows' JSON, not the heap they take:""",
     """  - some patterns scan a bounded stretch from many places: a Go DSN's, up to 256 characters from every `word:`, takes about 200 ms for 256 KB of `a:`;
  - the 32 MB budget counts the kept rows' JSON, not the heap they take:"""),
    ("""A row shaped as such a pair, as in a settings table (`{id, key: 'smtp_password', value}`), has its value fields masked the same way.""",
     """A row shaped as such a pair, as in a settings table (`{id, key: 'smtp_password', value}`), has its value fields masked the same way, never one of the collection's key fields."""),
])

edit('CHANGELOG.md', [
    ("""A collection's dropped columns are one flag, with their number and the first five, the seeded ones first.""",
     """A collection's dropped columns are one flag, with their number (`count`) and the first five (`fields`), the seeded ones first, counted in `seeded`; a diff entry carries its before snapshot's declared fields (`fieldsBefore`) for that."""),
])
print('ok')
