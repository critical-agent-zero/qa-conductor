import json
P = 'lib/data-diff.mjs'
T = ['test/data-diff.test.mjs']
m = [
    # H1: the run guard
    ('A1', "(?<![\\w.-])(?<!\\\\(?=\\\\))${QUOTE}", "(?<![\\w.-])${QUOTE}"),
    ('A2', "(?<![\\w.-])(?<!\\\\(?=\\\\))${QUOTE}", "(?<![\\w.\\\\-])${QUOTE}"),
    ('A3', "|&(?:quot|apos|#0{0,4}3[49]|#x0{0,4}2[27]);)`", ")`"),
    ('A4', "${QUOTE}?\\]?\\s{0,8}[:=]", "${QUOTE}?\\]?[:=]"),
    # tags
    ('B1', "<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})(?:\\s[^>]{0,256})?>", "<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})>"),
    ('B2', "<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})(?:\\s[^>]{0,256})?>", "<([\\w.-]{1,128})(?:\\s[^>]{0,256})?>"),
    # URLs
    ('C1', "(?:([^\\s/:@]{0,256}):([^\\s/]{1,256})|", "(?:([^\\s/:@]{1,256}):([^\\s/]{1,256})|"),
    ('C2', "(?:([^\\s/:@]{0,256}):([^\\s/]{1,256})|", "(?:([^\\s/:@]{0,256}):([^\\s/@]{1,256})|"),
    ('C3', "|([^\\s/:@]{16,256}))@/gi", "|([^\\s/:@]{1,256}))@/gi"),
    ('C4', "|([^\\s/:@]{16,256}))@/gi", "|(?!))()@/gi"),
    # Authorization values
    ('D1', "/\\b(bearer|basic|token)\\s{1,4}", "/\\b(Bearer|Basic|Token)\\s{1,4}"),
    ('D2', "|[A-Za-z0-9._~+/=-]{16,})/gi", "|[A-Za-z0-9._~+/=-]{8,})/gi"),
    ('D3', "((?=[A-Za-z0-9._~+/=-]{0,1024}\\d)[A-Za-z0-9._~+/=-]{8,}|", "((?=[A-Za-z0-9._~+/=-]{0,1024}\\d)(?!)|"),
    # pairs
    ('E1', "const PAIR_NAMES = new Set(['name', 'key', 'field', 'k'])", "const PAIR_NAMES = new Set(['name', 'key'])"),
    ('E2', "const PAIR_VALUES = new Set(['value', 'val', 'v'])", "const PAIR_VALUES = new Set(['value'])"),
    ('E3', "    const lower = k.toLowerCase()\n", "    const lower = k\n"),
    # enc
    ('F1', "      if (isTwice(value)) return { ...cellOfJsonText(toJson(held, where, 0)), enc: 2 }\n", ""),
    ('F2', "return isTwice(s) ? JSON.stringify(toJson(held, where, depth + 1)) : toJson(held, where, depth + 1)", "return toJson(held, where, depth + 1)"),
    # the cache
    ('G1', "    const cacheable = collection.length <= CACHED_NAME\n", "    const cacheable = true\n"),
    ('G2', "if (cacheable && field.length <= CACHED_NAME && fieldsCached < FIELD_CACHE)", "if (cacheable && fieldsCached < FIELD_CACHE)"),
    # omitted
    ('H1', "    if (!a) { put(collections, name, mayOmit(after) ? omittedChange(b, null, 'after') : changeOf('dropped', b, null, b.key)); continue }", "    if (!a) { put(collections, name, changeOf('dropped', b, null, b.key)); continue }"),
    ('H2', "    if (!b && mayOmit(before)) { put(collections, name, omittedChange(null, a, 'before')); continue }\n", ""),
    ('H3', "  return { collections, problems, omitted: total - n }", "  return { collections, problems, omitted: 0 }"),
    ('H4', "problems: ['the snapshot has no collections object'], omitted: null }", "problems: ['the snapshot has no collections object'], omitted: 0 }"),
    ('H5', "    if (b?.omitted || p?.omitted) status = 'unknown'\n", ""),
    ('H6', "  if (!d || d.omitted) return { inserted: 0, updated: 0, deleted: 0 }", "  if (!d) return { inserted: 0, updated: 0, deleted: 0 }"),
    ('H7', "    if (c.omitted) continue\n", ""),
    ('H8', "const shared = !c.omitted && !b.omitted && Boolean(b.truncated)", "const shared = Boolean(b.truncated)"),
    ('H9', "  const total = names.length\n", "  const total = names.filter(name => name.length <= MAX_NAME).length\n"),
    # fold and order
    ('I1', "    if (b === undefined) { prOnly.push(name); continue }\n", "    if (b === undefined) { flags.push({ collection: name, kind: 'unverified', severity: 'red', shared: false, pr: 1, base: 0 }); continue }\n"),
    ('I2', "    || prOwn(x) - prOwn(y)\n", ""),
    ('I3', "    || late(x) - late(y)\n", ""),
    ('I4', "  const order = (x, y) => (x.severity === y.severity ? 0 : x.severity === 'red' ? -1 : 1)\n    ||", "  const order = (x, y) =>"),
    ('I5', "names: prOnly.slice(0, 5) })", "names: prOnly.slice(0, 4) })"),
    # caps
    ('J1', "  if (named.length > MAX_KEY_FIELDS) {", "  if (named.length > MAX_KEY_FIELDS + 1) {"),
    ('J2', "  if (fields && fields.length > MAX_FIELDS) {", "  if (fields && fields.length > MAX_FIELDS + 1) {"),
    ('J3', "  let size = sizeOf(named) + sizeOf(fields)\n", "  let size = 0\n"),
    ('J4', "  const long = names.filter(name => name.length > MAX_NAME).length", "  const long = names.filter(name => name.length > MAX_NAME + 1).length"),
    # survivors from round 3
    ('K1', "    count = Math.max(Number.isSafeInteger(c?.count) && c.count >= 0 ? c.count : 0, rows)", "    count = rows"),
    ('K2', "      const had = new Set(b.fields)\n      const has = new Set(a.fields)\n      out.fieldsDropped = b.fields.filter(f => !has.has(f))\n      out.fieldsAdded = a.fields.filter(f => !had.has(f))", "      out.fieldsDropped = b.fields.filter(f => !a.fields.includes(f))\n      out.fieldsAdded = a.fields.filter(f => !b.fields.includes(f))"),
    ('K3', "    if (!c.truncated || c.status === 'dropped') continue\n    const b = own(baseDiff.collections, name)\n    if (b === undefined)", "    if (!c.truncated) continue\n    const b = own(baseDiff.collections, name)\n    if (b === undefined)"),
    ('K4', "&& b.countBefore === c.countBefore && b.countAfter === c.countAfter", "&& b.countAfter === c.countAfter"),
]
out = [{'id': i, 'file': P, 'old': o, 'new': n, 'tests': T} for (i, o, n) in m]
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-35.json', 'w'), indent=1)
print(len(out))
