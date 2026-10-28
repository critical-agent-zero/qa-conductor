p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-capture.mjs'
s = open(p).read()
start = s.index("  for (const { list, item } of queue) {\n    {\n      {\n")
tail = "        list.done++\n      }\n    }\n  }\n"
end = s.index(tail, start) + len(tail)
block = s[start:end]
lines = block.split('\n')
body = lines[3:-5]
done = lines[-5]
new = ["  for (const { list, item } of queue) {"] + [l[4:] if l.startswith('    ') else l for l in body] + [done[4:], "  }", ""]
s = s[:start] + '\n'.join(new) + s[end:]
a = """// A span's flags as an answer lists them, in the answer's order (inAnswerOrder).
// The PR's own past LISTED_UNVERIFIED and so on, as before."""
b = """// A span's flags as an answer lists them, in the answer's order
// (inAnswerOrder): the base pane's collections' first, red first among
// them and among the PR's own."""
assert s.count(a) == 1
s = s.replace(a, b)
open(p, 'w').write(s)
print('ok')
