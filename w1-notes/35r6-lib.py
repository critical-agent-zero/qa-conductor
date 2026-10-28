R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/data-diff.mjs', [
    # element rule first, before the DSN rule can swallow a '>'
    ("""    const masked = head
      .replace(URL_USERINFO, (_, scheme, user, pw, token) => {""",
     """    const masked = head
      // an element whose key, name, id or type looks secret: its value. First,
      // so a later rule (a DSN's, say) can't run past the element's '>'
      .replace(ATTR_TAG, tag => ([...tag.matchAll(ATTR_NAME)].some(m => SECRET_NAME.test(m[2] ?? m[3] ?? m[4]))
        ? tag.replace(ATTR_VALUE, (_, name, eq, dq, sq, bare) => {
          const value = dq ?? sq ?? bare
          const q = dq !== undefined ? '"' : sq !== undefined ? "'" : ''
          return `${name}${eq}${q}${hidden('x', value)}${q}`
        })
        : tag))
      .replace(URL_USERINFO, (_, scheme, user, pw, token) => {"""),
    ("""      .replace(JWT, value => hidden('j', value))
      // an element whose key, name, id or type looks secret: its value
      .replace(ATTR_TAG, tag => ([...tag.matchAll(ATTR_NAME)].some(m => SECRET_NAME.test(m[2] ?? m[3] ?? m[4]))
        ? tag.replace(ATTR_VALUE, (_, name, eq, dq, sq, bare) => {
          const value = dq ?? sq ?? bare
          const q = dq !== undefined ? '"' : sq !== undefined ? "'" : ''
          return `${name}${eq}${q}${hidden('x', value)}${q}`
        })
        : tag))""",
     """      .replace(JWT, value => hidden('j', value))"""),
    # DSN: up to the last '@', ':' allowed again
    ("""// - a Go DSN's password (`user:pw@tcp(…)`, `@tcp6(`, `@unix(`, any
//   network, or `@/`), up to its last '@' and never across a ':';""",
     """// - a Go DSN's password (`user:pw@tcp(…)`, `@tcp6(`, `@unix(`, any
//   network, or `@/`), up to its last '@', a ':' included;"""),
    ("""// Each scans a bounded stretch from where it starts.""",
     """// Each scans a bounded stretch from where it starts (the DSN's, up to 256
// characters from every `word:`: its cost is the README's, Hostile PR data)."""),
    ("""const DSN_USERINFO = /(?<![\\w.-])([\\w.-]{1,64}):([^\\s/:]{1,256})@((?:[a-z][\\w-]{0,31})?\\(|\\/)/gi""",
     """const DSN_USERINFO = /(?<![\\w.-])([\\w.-]{1,64}):([^\\s/]{1,256})@((?:[a-z][\\w-]{0,31})?\\(|\\/)/gi"""),
    # rows as pairs: never a key field
    ("""    // a row that is a name and value pair (a settings table's `{key:
    // 'smtp_password', value}`): its value fields are secret
    const pair = pairOf(r)
    for (const field of Object.keys(r).sort()) {
      if (drop.has(field)) continue
      put(row, field, presence.has(field) ? isSet(r[field]) : masker.cell(name, field, r[field], pair !== null && pair.values.includes(field)))
    }""",
     """    // a row that is a name and value pair (a settings table's `{key:
    // 'smtp_password', value}`): its value fields are secret, but never one
    // of the collection's key fields, which must keep matching rows
    const pair = pairOf(r)
    for (const field of Object.keys(r).sort()) {
      if (drop.has(field)) continue
      const paired = pair !== null && pair.values.includes(field) && !named.includes(field)
      put(row, field, presence.has(field) ? isSet(r[field]) : masker.cell(name, field, r[field], paired))
    }"""),
    # left out, or cut short by the PR where the base wasn't: with what loses rows
    ("""  // a base-pane collection the PR's snapshots may have left out: its drop
  // or wipe can't be seen, so its unverified flag stands with what loses rows
  const leftOut = f => f.kind === 'unverified' && typeof f.collection === 'string'
    && (!Object.hasOwn(prDiff.collections, f.collection) || Boolean(own(prDiff.collections, f.collection).omitted))""",
     """  // a base-pane collection the PR's snapshots may have left out, or cut
  // short where the base pane's didn't (a PR's padding can push it into a
  // count): its drop or wipe can't be seen, so its unverified flag stands
  // with what loses rows
  const leftOut = f => {
    if (f.kind !== 'unverified' || typeof f.collection !== 'string') return false
    const c = own(prDiff.collections, f.collection)
    const b = own(baseDiff.collections, f.collection)
    return c === undefined || Boolean(c.omitted) || (Boolean(c.truncated) && b !== undefined && !b.truncated)
  }"""),
])
print('ok')
