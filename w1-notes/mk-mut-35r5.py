import json
F = 'lib/data-diff.mjs'
T = ['test/data-diff.test.mjs']
m = [
    ('P1', "(?:(?<![\\w.-])|(?<=%[0-9a-f]{2})|(?<=(?<!\\\\)\\\\[nrt]))", "(?:(?<![\\w.-])|(?<=(?<!\\\\)\\\\[nrt]))"),
    ('P2', "(?:(?<![\\w.-])|(?<=%[0-9a-f]{2})|(?<=(?<!\\\\)\\\\[nrt]))", "(?:(?<![\\w.-])|(?<=%[0-9a-f]{2}))"),
    ('P3', "        if (past !== null && past !== m[1] && SECRET_NAME.test(past)) return true\n", ""),
    ('P4', "before === '%' ? m[1].replace(/^[0-9a-f]{2}/i, '')", "before === '%' ? m[1]"),
    ('P5', "before === '\\\\' ? m[1].replace(/^[nrt]/, '')", "before === '\\\\' ? m[1]"),
    ('T1', "const TAG_IN_TEXT = /<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})(?=[\\s/>])/g", "const TAG_IN_TEXT = /<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})(?:\\s[^<>]{0,256})?>/g"),
    ('T2', "([\\w.-]{1,128})(?=[\\s/>])/g", "([\\w.-]{1,128})(?=[\\s>])/g"),
    ('C1', "        columns = { count: mine.n, seeded: seeded.length, fields: [...seeded, ...others].slice(0, 5) }", "        columns = { count: mine.n, seeded: seeded.length, fields: [...mine.items].sort().slice(0, 5) }"),
    ('C2', "    fieldsBefore: b?.fields ?? null,", "    fieldsBefore: null,"),
    ('A1', "      if (name === null && typeof obj[k] === 'string' && SECRET_NAME.test(obj[k])) name = obj[k]", "      if (name === null && typeof obj[k] === 'string') name = SECRET_NAME.test(obj[k]) ? obj[k] : ''"),
    ('A2', "    const pair = pairOf(r)\n", "    const pair = null\n"),
    ('A3', "    const as = secret && named !== 'plain' ? 'secret' : named", "    const as = named"),
    ('D1', "@((?:[a-z][\\w-]{0,31})?\\(|\\/)/gi", "@((?:tcp|udp|unix)\\()/gi"),
    ('D2', "([^\\s/:]{1,256})@((?:", "([^\\s@/:]{1,256})@((?:"),
    ('D3', "([^\\s/:]{1,256})@((?:", "([^\\s/]{1,256})@((?:"),
    ('X1', "|([^\\s\"'<>=\\x60]{1,128}))/gi\nconst ATTR_VALUE", ")/gi\nconst ATTR_VALUE"),
    ('X2', "|'([^']*)'|([^\\s\"'<>=\\x60]+))/gi", "|'([^']*)')/gi"),
    ('X3', "const ATTR_VALUE = /\\b(value)(", "const ATTR_VALUE = /\\b(VALUE)("),
    ('G1', "(?=[\\s=])/gi\nconst MYSQL_P", "(?=[ =])/gi\nconst MYSQL_P"),
    ('G2', "PRIVATE KEY(?: BLOCK)?-----/", "PRIVATE KEY-----/"),
    ('L1', "  const late = f => (LOSES_ROWS.has(f.kind) || leftOut(f) ? 0", "  const late = f => (LOSES_ROWS.has(f.kind) ? 0"),
    ('L2', "    && (!Object.hasOwn(prDiff.collections, f.collection) || Boolean(own(prDiff.collections, f.collection).omitted))", "    && !Object.hasOwn(prDiff.collections, f.collection)"),
]
out = [{'id': i, 'file': F, 'old': o, 'new': n, 'tests': T} for (i, o, n) in m]
src = open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/' + F).read()
for x in out:
    if src.count(x['old']) != 1:
        print('miss', x['id'], src.count(x['old']))
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-35r5.json', 'w'), indent=1)
print(len(out))
