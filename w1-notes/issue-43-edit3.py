import json
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
raw = open(N + 'issue-43-live3.md').read()
title, s = raw.split('\n----\n', 1)


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""- on macOS 14, either 2a to 2g (with 2c2) hold by hand, run a few times, or CI's `macos-sandbox` job passes on `macos-14` in 10 runs in a row, 30 rounds each, with the `*:<port>` form.""",
    """- on macOS 14, with the `*:<port>` form, either:
  - **in CI:** the `macos-sandbox` job passes on `macos-14` in 10 runs in a row, 30 rounds each; or
  - **by hand, as strong:** from a checkout of #41, `QA_REQUIRE_SANDBOX=1 QA_SANDBOX_ROUNDS=30 node --test --test-force-exit --test-name-pattern="sandbox-exec profile" test/docs.test.mjs` passes 10 times in a row on a macOS 14 Mac. Or 2c and 2c2 are looped at least 100 times each, with every one `EPERM`. Post the counts.

**The running count on CI's `macos-14` runner, with the `*:<port>` form:** 8 clean runs in a row, 30 rounds each: #41's run on `db5bfec`, and 7 reruns on the fork. Each round tries every named port over seven address forms. Updated here as more run.""")
json.dump({'body': s}, open(N + 'issue-43-new3.json', 'w'))
print('ok')
