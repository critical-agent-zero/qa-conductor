import json
F = 'lib/data-diff.mjs'
T = ['test/data-diff.test.mjs']
m = [
    ('Q1 cut by name', "sort((x, y) => y[0] - x[0] || (x[1] < y[1] ? -1 : 1))", "sort((x, y) => (x[1] < y[1] ? -1 : 1))"),
    ('Q2 no counts kept', "    for (const name of stubs) counted.set(name, stubOf(own(given, name)))\n", ""),
    ('Q3 no cap on counts', "byRows.slice(maxCollections, maxCollections * (1 + COUNTED_COLLECTIONS))", "byRows.slice(maxCollections)"),
    ('Q4 missing not flagged', "    if (!Object.hasOwn(prDiff.collections, name)) flags.push(", "    if (false) flags.push("),
    ('Q5 missing same', " || Boolean(b && !p)", ""),
    ('Q6 Set unset', "  if (value instanceof Set || value instanceof Map) return value.size > 0\n", ""),
    ('Q7 no head cap', "    const head = s.length > HELD_JSON_MAX ? s.slice(0, HELD_JSON_MAX) : s\n    if (/[:=]/.test(head))", "    const head = s\n    if (/[:=]/.test(head))"),
    ('Q8 no word start', "const KEY_IN_TEXT = /(?<![\\w.-])(?:", "const KEY_IN_TEXT = /(?:"),
    ('Q9 no escaped quote', "const KEY_IN_TEXT = /(?<![\\w.-])(?:\\\\*[\"'])?([\\w.-]{1,128})(?:\\\\*[\"'])?", "const KEY_IN_TEXT = /(?<![\\w.-])(?:[\"'])?([\\w.-]{1,128})(?:[\"'])?"),
    ('Q10 no bracket', "{1,128})(?:\\\\*[\"'])?\\]?\\s{0,8}[:=]/g", "{1,128})(?:\\\\*[\"'])?\\s{0,8}[:=]/g"),
    ('Q11 no tag', "    if (head.includes('<')) for (const m of head.matchAll(TAG_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true\n", ""),
    ('Q12 no double', "  function heldJson(s, twice = true) {", "  function heldJson(s, twice = false) {"),
    ('Q13 no field cap', "if (fieldsCached < FIELD_CACHE) {", "if (true) {"),
    ('Q14 no userinfo', "      .replace(URL_USERINFO,", "      .replace(/(?!)/g,"),
    ('Q15 no auth value', "      .replace(AUTH_VALUE,", "      .replace(/(?!)/g,"),
    ('Q16 no raw headers', "      if (Array.isArray(v) && v.some(x => typeof x === 'string' && SECRET_NAME.test(x))) {", "      if (false) {"),
    ('Q17 no pairs', "        if (name !== null && SECRET_NAME.test(name)) return { ...v, value: secret(name, v.value) }", "        if (false) return v"),
    ('Q18 update id without values', "u.fields.map(f => `${f.field}=${canon(f.after)}`)", "u.fields.map(f => f.field)"),
    ('Q19 both cut not listed', "    const shared = Boolean(b?.truncated) && b.countBefore === c.countBefore && b.countAfter === c.countAfter\n    const severity", "    if (b?.truncated && !changed) continue\n    const shared = Boolean(b?.truncated) && b.countBefore === c.countBefore && b.countAfter === c.countAfter\n    const severity"),
    ('Q20 key lost on counts', "key === null && !out.truncated", "key === null"),
    ('Q21 no ssh backup', "ssh[-_]?key|", ""),
    ('Q22 both cut red', "(b?.truncated && !changed) || (trusted === true && shared) ? 'amber' : 'red'", "(trusted === true && shared) ? 'amber' : 'red'"),
    ('Q23 cache reset kept', "{ classes.clear(); fieldsCached = 0 }", "{ classes.clear() }"),
]
json.dump([{'id': i, 'file': F, 'old': o, 'new': n, 'tests': T} for i, o, n in m],
          open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-35r2.json', 'w'), indent=1)
print(len(m))
