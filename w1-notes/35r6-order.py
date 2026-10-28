p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-diff.mjs'
s = open(p).read()
a = """    const masked = head
      // an element whose key, name, id or type looks secret: its value. First,
      // so a later rule (a DSN's, say) can't run past the element's '>'
      .replace(ATTR_TAG, tag => ([...tag.matchAll(ATTR_NAME)].some(m => SECRET_NAME.test(m[2] ?? m[3] ?? m[4]))
        ? tag.replace(ATTR_VALUE, (_, name, eq, dq, sq, bare) => {
          const value = dq ?? sq ?? bare
          const q = dq !== undefined ? '"' : sq !== undefined ? "'" : ''
          return `${name}${eq}${q}${hidden('x', value)}${q}`
        })
        : tag))
      .replace(URL_USERINFO, (_, scheme, user, pw, token) => {
        if (token !== undefined) return `${scheme}${hidden('u', token)}@`
        // a user that is a token: one that looks like it, or one with no
        // password or GitHub's x-oauth-basic beside it
        const oauth = /^x-oauth-basic$/i.test(pw)
        const userShown = user !== '' && (tokenLike(user) || pw === '' || oauth) ? hidden('u', user) : user
        return `${scheme}${userShown}:${pw === '' || oauth ? pw : hidden('u', pw)}@`
      })
      .replace(AUTH_VALUE, (match, scheme, value) => (authToken(scheme, value) ? `${scheme} ${hidden('a', value)}` : match))
      .replace(DSN_USERINFO, (_, user, pw, rest) => `${user}:${hidden('d', pw)}@${rest}`)
      .replace(JWT, value => hidden('j', value))
    return head === s ? masked : masked + s.slice(HELD_JSON_MAX)
  }"""
b = """    // In this order: a URL's credentials and a scheme's value first (as
    // before round 6), then an element's value, before a DSN's rule, whose
    // password may hold '>' and so could otherwise run past the element's
    const withUrls = head.replace(URL_USERINFO, (_, scheme, user, pw, token) => {
      if (token !== undefined) return `${scheme}${hidden('u', token)}@`
      // a user that is a token: one that looks like it, or one with no
      // password or GitHub's x-oauth-basic beside it
      const oauth = /^x-oauth-basic$/i.test(pw)
      const userShown = user !== '' && (tokenLike(user) || pw === '' || oauth) ? hidden('u', user) : user
      return `${scheme}${userShown}:${pw === '' || oauth ? pw : hidden('u', pw)}@`
    })
    const masked = authValues(withUrls, value => hidden('a', value))
      // an element whose key, name, id or type looks secret: its value
      .replace(ATTR_TAG, tag => ([...tag.matchAll(ATTR_NAME)].some(m => SECRET_NAME.test(m[2] ?? m[3] ?? m[4]))
        ? tag.replace(ATTR_VALUE, (_, name, eq, dq, sq, bare) => {
          const value = dq ?? sq ?? bare
          const q = dq !== undefined ? '"' : sq !== undefined ? "'" : ''
          return `${name}${eq}${q}${hidden('x', value)}${q}`
        })
        : tag))
      .replace(DSN_USERINFO, (_, user, pw, rest) => `${user}:${hidden('d', pw)}@${rest}`)
      .replace(JWT, value => hidden('j', value))
    return head === s ? masked : masked + s.slice(HELD_JSON_MAX)
  }"""
assert s.count(a) == 1
s = s.replace(a, b)
a = """// An Authorization value that looks like a token: a digit in it, or 16"""
b = """// Each Authorization scheme's value in text that looks like a token,
// replaced by `hide(value)`. One that doesn't is passed over by the
// scheme's name only, so its text can still hold the next scheme (`Bearer
// //bearer <token>`).
function authValues(text, hide) {
  const re = new RegExp(AUTH_VALUE.source, 'gi')
  let out = ''
  let last = 0
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const [whole, scheme, value] = m
    if (authToken(scheme, value)) {
      out += `${text.slice(last, m.index)}${scheme} ${hide(value)}`
      last = m.index + whole.length
    } else re.lastIndex = m.index + scheme.length
  }
  return out + text.slice(last)
}
// An Authorization value that looks like a token: a digit in it, or 16"""
assert s.count(a) == 1
s = s.replace(a, b)
open(p, 'w').write(s)
print('ok')
