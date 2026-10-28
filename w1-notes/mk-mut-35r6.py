import json
F = 'lib/data-diff.mjs'
T = ['test/data-diff.test.mjs', 'test/data-masking-corpus.test.mjs']
m = [
    ('Q1', "([^\\s/]{1,256})@((?:[a-z][\\w-]{0,31})?\\(|\\/)/gi", "([^\\s/:]{1,256})@((?:[a-z][\\w-]{0,31})?\\(|\\/)/gi"),
    ('Q2', """      .replace(DSN_USERINFO, (_, user, pw, rest) => `${user}:${hidden('d', pw)}@${rest}`)
      .replace(JWT, value => hidden('j', value))""", """      .replace(JWT, value => hidden('j', value))"""),
    ('Q3', "    } else re.lastIndex = m.index + scheme.length", "    } else { out += text.slice(last, m.index + whole.length); last = m.index + whole.length }"),
    ('Q4', "      const paired = pair !== null && pair.values.includes(field) && !named.includes(field)", "      const paired = pair !== null && pair.values.includes(field)"),
    ('Q5', "    return c === undefined || Boolean(c.omitted) || (Boolean(c.truncated) && b !== undefined && !b.truncated)", "    return c === undefined || Boolean(c.omitted)"),
    ('Q6', "    return c === undefined || Boolean(c.omitted) || (Boolean(c.truncated) && b !== undefined && !b.truncated)", "    return Boolean(c?.omitted) || (Boolean(c?.truncated) && b !== undefined && !b.truncated)"),
    ('Q7', "    fieldsBefore: b?.fields ?? null,", "    fieldsBefore: a?.fields ?? null,"),
    ('Q8', "const MYSQL_P = /\\b(?:mysql|mysqldump|mysqladmin|mariadb)\\b[^\\n]{0,256}?\\s-p[^\\s-]/i", "const MYSQL_P = /\\b(?:mysql|mysqldump|mysqladmin|mariadb)\\b[^\\n]{0,256}?\\s-p[^\\s-]/"),
]
out = [{'id': i, 'file': F, 'old': o, 'new': n, 'tests': T} for (i, o, n) in m]
R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
src = open(R + F).read()
for x in out:
    if src.count(x['old']) != 1:
        print('miss', x['id'], src.count(x['old']))
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-35r6.json', 'w'), indent=1)
print(len(out))
