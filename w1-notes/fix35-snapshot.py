p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-diff.mjs'
s = open(p).read()

a = "export const LIMITS = Object.freeze({ maxRows: 10_000, maxBytes: 32 * 1024 * 1024, timeoutMs: 30_000 })"
b = "export const LIMITS = Object.freeze({ maxRows: 10_000, maxBytes: 32 * 1024 * 1024, maxCollections: 1_000, timeoutMs: 30_000 })"
assert a in s
s = s.replace(a, b, 1)

start = s.index("export function sanitizeSnapshot(raw, { masker, rules, limits }) {")
end = s.index("function sanitizeCollection(name, c, { masker, rules, maxRows, budget, problems }) {")
new = '''export function sanitizeSnapshot(raw, { masker, rules, limits }) {
  const { maxRows = LIMITS.maxRows, maxBytes = LIMITS.maxBytes, maxCollections = LIMITS.maxCollections } = limits ?? {}
  const problems = []
  const collections = {}
  let names
  let given
  try {
    given = raw?.collections
    if (!given || typeof given !== 'object' || Array.isArray(given)) return { collections, problems: ['the snapshot has no collections object'] }
    names = Object.keys(given).filter(name => !rules.exclude.some(p => globMatch(p, name))).sort()
  } catch (err) {
    return { collections, problems: [`the snapshot could not be read: ${String(err?.message ?? err)}`] }
  }
  if (names.length > maxCollections) {
    problems.push(`${names.length - maxCollections} collections past the first ${maxCollections} were left out`)
    names = names.slice(0, maxCollections)
  }
  // The byte budget is shared fairly: collections with the fewest rows go
  // first, and each may use at most an equal share of what is left, so one
  // collection (a PR's padding, say) can't starve the others.
  const rowsOf = name => { try { const rows = own(given, name)?.rows; return Array.isArray(rows) ? rows.length : 0 } catch { return 0 } }
  const order = names.map(name => [rowsOf(name), name]).sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)).map(([, name]) => name)
  let left = maxBytes
  const kept = new Map()
  order.forEach((name, i) => {
    const budget = Math.floor(left / (order.length - i))
    try {
      const out = sanitizeCollection(name, own(given, name), { masker, rules, maxRows, budget, problems })
      if (out === null) return
      left -= out.size
      kept.set(name, out.collection)
    } catch (err) {
      problems.push(`${name}: could not be read: ${String(err?.message ?? err)}`)
    }
  })
  for (const name of names) if (kept.has(name)) put(collections, name, kept.get(name))
  return { collections, problems }
}

'''
s = s[:start] + new + s[end:]
open(p, 'w').write(s)
print('ok')
