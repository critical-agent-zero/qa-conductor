R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


def each(names):
    return ', '.join(f"'rm -f -v {n}'" for n in names.split())


edit('test/provisioner-docker.test.mjs', [
    ("""    'rm -f -v qa-app-base qa-migrate-base qa-pg-base',
    'network rm qa-session-base',
    'rm -f -v qa-app-pr qa-migrate-pr qa-probe-pr qa-pg-pr',
    'network rm qa-session-pr',
  ])
  assert.deepEqual(s.fsx.removed, [`${WORK}/.env.qa-base`, `${WORK}/.env.qa-pr`])

  // The shared network""",
     f"""    {each('qa-app-base qa-migrate-base qa-pg-base')},
    'network rm qa-session-base',
    {each('qa-app-pr qa-migrate-pr qa-probe-pr qa-pg-pr')},
    'network rm qa-session-pr',
  ])
  assert.deepEqual(s.fsx.removed, [`${{WORK}}/.env.qa-base`, `${{WORK}}/.env.qa-pr`])

  // The shared network"""),
    ("""    'rm -f -v qa-app-base qa-migrate-base qa-pg-base', 'network rm qa-session-base',
    'rm -f -v qa-app-pr qa-migrate-pr qa-probe-pr qa-pg-pr', 'network rm qa-session-pr',
  ])""",
     f"""    {each('qa-app-base qa-migrate-base qa-pg-base')}, 'network rm qa-session-base',
    {each('qa-app-pr qa-migrate-pr qa-probe-pr qa-pg-pr')}, 'network rm qa-session-pr',
  ])"""),
    ("""  assert.deepEqual(docker(s.exec).map(c => c.args.join(' ')).at(-2), 'rm -f -v qa-app-pr qa-migrate-pr qa-probe-pr qa-pg-pr')""",
     """  assert.deepEqual(docker(s.exec).map(c => c.args.join(' ')).slice(-5, -1), ['rm -f -v qa-app-pr', 'rm -f -v qa-migrate-pr', 'rm -f -v qa-probe-pr', 'rm -f -v qa-pg-pr'])"""),
    ("""    'rm -f -v qa-app-pr qa-migrate-pr qa-probe-pr qa-fwd-pr qa-pg-pr',
    'network rm qa-session-pr',
    'network rm qa-session-pr-edge',""",
     f"""    {each('qa-app-pr qa-migrate-pr qa-probe-pr qa-fwd-pr qa-pg-pr')},
    'network rm qa-session-pr',
    'network rm qa-session-pr-edge',"""),
    ("""  assert.deepEqual(argvOf(s.exec).slice(before), ['rm -f -v qa-app-base qa-migrate-base qa-pg-base', 'network rm qa-session-base'])""",
     f"""  assert.deepEqual(argvOf(s.exec).slice(before), [{each('qa-app-base qa-migrate-base qa-pg-base')}, 'network rm qa-session-base'])"""),
])

edit('test/docker.test.mjs', [
    ("""test('rmForce removes all names in one call, and tolerates only names already gone', async () => {
  const exec = recordingExec()
  const docker = createDocker({ execFileFn: exec })
  await docker.rmForce(['qa-app-base', 'qa-pg-base'])
  assert.deepEqual(exec.calls, [['docker', 'rm', '-f', '-v', 'qa-app-base', 'qa-pg-base']])""",
     """test('rmForce removes each name in a call of its own, and tolerates only names already gone', async () => {
  const exec = recordingExec()
  const docker = createDocker({ execFileFn: exec })
  await docker.rmForce(['qa-app-base', 'qa-pg-base'])
  assert.deepEqual(exec.calls, [['docker', 'rm', '-f', '-v', 'qa-app-base'], ['docker', 'rm', '-f', '-v', 'qa-pg-base']])"""),
    ("""    ['docker', 'rm', '-f', '-v', 'abc123', 'def456'],
  ])
  assert.deepEqual(ids, ['abc123', 'def456'])""",
     """    ['docker', 'rm', '-f', '-v', 'abc123'],
    ['docker', 'rm', '-f', '-v', 'def456'],
  ])
  assert.deepEqual(ids, ['abc123', 'def456'])"""),
])
print('ok')
