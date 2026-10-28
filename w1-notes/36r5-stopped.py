R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'lib/data-capture.mjs'
s = open(R + P).read()


def sub(a, b, n=1):
    global s
    assert s.count(a) == n, (a[:80], s.count(a))
    s = s.replace(a, b)


sub("  let stopped = false\n", "")
sub("      if (size > budget.left) { stopped = true; break }\n", "      if (size > budget.left) break\n", 2)
sub("...(stopped && list.done < list.todo.length ? { cut: true } : {})", "...(list.done < list.todo.length ? { cut: true } : {})")
open(R + P, 'w').write(s)
print('ok')
