import json
F = 'lib/data-diff.mjs'
T = ['test/data-diff.test.mjs']
m = [
    ('N1', "(?:\\s[^<>]{0,256})?>/g\nconst FLAG", "(?:\\s[^>]{0,256})?>/g\nconst FLAG"),
    ('N2', "    add('column-dropped', null, c.fieldsDropped.length, [...c.fieldsDropped])", "    for (const field of c.fieldsDropped) add('column-dropped', field, 1, [field])"),
    ('N3', ".sort().slice(0, 5) }", ".slice(0, 5) }"),
    ('N4', "  if (!strict && keys.length > 6) return null", "  if (keys.length > 6) return null"),
    ('N5', "  if (!strict && keys.length > 6) return null", "  if (!strict && keys.length > 2) return null"),
    ('N6', "  if (!strict && keys.length > 6) return null", ""),
    ('N7', "    || ((isText(obj, 'Name') || isText(obj, 'Key')) && Object.hasOwn(obj, 'Value'))", ""),
    ('N8', "    else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) values.push(k)", "    else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined && values.length === 0) values.push(k)"),
    ('N9', "    else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) values.push(k)", "    else if (PAIR_VALUES.has(lower)) values.push(k)"),
    ('N10', "    if (name === null && PAIR_NAMES.has(lower) && typeof obj[k] === 'string') name = obj[k]", "    if (name === null && PAIR_NAMES.has(lower)) name = String(obj[k])"),
    ('N11', "  return { collections, problems, omitted: total - long - n }", "  return { collections, problems, omitted: total - n }"),
    ('N12', 'const QUOTE = String.raw`(?:\\\\*["\'\\x60]', 'const QUOTE = String.raw`(?:\\\\?["\'\\x60]'),
    ('N13', 'const QUOTE = String.raw`(?:\\\\*["\'\\x60]', 'const QUOTE = String.raw`(?:\\\\*["\']'),
    ('N14', "#x0{0,4}2[27]);|%2[27])`", "#x0{0,4}2[27]);)`"),
    ('N15', "\\s{0,32}(?:[:=]|%3[ad])`, 'gi')", "\\s{0,32}(?:[:=]|%3[ad])`, 'g')"),
    ('N16', "\\s{0,32}(?:[:=]|%3[ad])`, 'gi')", "\\s{0,8}(?:[:=]|%3[ad])`, 'gi')"),
    ('N17', "\\s{0,32}(?:[:=]|%3[ad])`, 'gi')", "\\s{0,32}[:=]`, 'gi')"),
    ('N18', "(?<=^|[^\\w.-]|%[0-9a-f]{2})", "(?<=^|[^\\w.-])"),
    ('N19', "      for (const m of head.matchAll(FLAG_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true\n", ""),
    ('N20', "      if (MYSQL_P.test(head) || PEM_KEY.test(head)) return true", "      if (PEM_KEY.test(head)) return true"),
    ('N21', "      if (MYSQL_P.test(head) || PEM_KEY.test(head)) return true", "      if (MYSQL_P.test(head)) return true"),
    ('N22', "    if (/[:=]|%3[ad]/i.test(head)) for", "    if (/[:=]/.test(head)) for"),
    ('N23', "        const userShown = user !== '' && (tokenLike(user) || pw === '' || oauth) ? hidden('u', user) : user", "        const userShown = user !== '' && (pw === '' || oauth) ? hidden('u', user) : user"),
    ('N24', "        const userShown = user !== '' && (tokenLike(user) || pw === '' || oauth) ? hidden('u', user) : user", "        const userShown = user !== '' && (tokenLike(user) || oauth) ? hidden('u', user) : user"),
    ('N25', "        const userShown = user !== '' && (tokenLike(user) || pw === '' || oauth) ? hidden('u', user) : user", "        const userShown = user !== '' && (tokenLike(user) || pw === '') ? hidden('u', user) : user"),
    ('N26', "  || (/^basic$/i.test(scheme) && value.length % 4 === 0", "  || (false && value.length % 4 === 0"),
    ('N27', "/[0-9+/=]|.[A-Z]/.test(value))", "/[0-9+/=]|[A-Z]/.test(value))"),
    ('N28', "      .replace(DSN_USERINFO, (_, user, pw, proto) => `${user}:${hidden('d', pw)}@${proto}(`)\n", ""),
    ('N29', "      .replace(JWT, value => hidden('j', value))\n", ""),
    ('N30', "      .replace(ATTR_TAG, tag => ([...tag.matchAll(ATTR_NAME)].some(m => SECRET_NAME.test(m[2]))", "      .replace(ATTR_TAG, tag => ([...tag.matchAll(ATTR_NAME)].slice(0, 1).some(m => SECRET_NAME.test(m[2]))"),
    ('N31', "|(?:^|[-_])(?:pin|pw|psk)(?:[-_]|$)|^_?auth$/i", "|(?:^|[-_])(?:pin)(?:[-_]|$)/i"),
    ('N32', "const tokenLike = s => /^(?:gh[pousr]_|github_pat_|glpat-|xox[abpr]-|sk_live_|sk-)/.test(s) || (s.length >= 16 && /\\d/.test(s))", "const tokenLike = s => (s.length >= 16 && /\\d/.test(s))"),
    ('N33', "(?:([^\\s/:@]{0,256}):([^\\s/]{0,256})|", "(?:([^\\s/:@]{0,256}):([^\\s/]{1,256})|"),
    ('N34', "  const late = f => (LOSES_DATA.has(f.kind) ? 0 : f.kind === 'unverified' || f.kind === 'cleared' ? 2 : 1)", "  const late = f => (LOSES_DATA.has(f.kind) ? 0 : f.kind === 'unverified' ? 2 : 1)"),
    ('N35', "      else if (was.items !== null && items !== null) { merged = was.items; for (const item of items) merged.push(item) }", "      else if (was.items !== null && items !== null) { merged = [...was.items, ...items] }"),
]
out = [{'id': i, 'file': F, 'old': o, 'new': n, 'tests': T} for (i, o, n) in m]
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-35r4b.json', 'w'), indent=1)
print(len(out))
