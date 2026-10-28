R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:100], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/docker.mjs', [
    ("""// Lines a CLI writes to stderr that say nothing of the failure: the
// "Command failed" line makeExecFileFn puts first in a message, the
// podman-docker shim's banner (on every call), and Podman's logger's
// warnings and notes (WARN[0000] … on a TTY, time="…" level=warning … in a
// pipe). Its errors (ERRO, level=error) are kept.
const NOISE = [
  /^(docker \\S+: )?Command failed/i,
  /^Emulate Docker CLI using podman\\./,
  /^(WARN|INFO|DEBU)\\[\\d+\\] /,
  /^time="[^"]*" level=(warning|info|debug) /,
]""", """// Lines a CLI writes to stderr that say nothing of the failure: the
// "Command failed" line makeExecFileFn puts first in a message, the
// podman-docker shim's banner (on every call), Podman's logger's warnings
// and notes (WARN[0000] … on a TTY, time="…" level=warning … in a pipe),
// and the "exit status 1" the docker CLI on CI's Ubuntu runners adds after
// its error. Podman's logger's errors (ERRO, level=error) are kept.
const NOISE = [
  /^(docker \\S+: )?Command failed/i,
  /^Emulate Docker CLI using podman\\./,
  /^(WARN|INFO|DEBU)\\[\\d+\\] /,
  /^time="[^"]*" level=(warning|info|debug) /,
  /^exit status \\d+$/,
]"""),
])
edit('test/docker.test.mjs', [
    ("""    dockerFailure(`${LOGRUS_PIPE}\\n${LOGRUS_TTY}\\nError: unable to find network with name or ID qa-session-base: network not found\\n`),
  ]) {
    await createDocker({ execFileFn: recordingExec([err]) }).rmNetwork('gone')
  }""", """    dockerFailure(`${LOGRUS_PIPE}\\n${LOGRUS_TTY}\\nError: unable to find network with name or ID qa-session-base: network not found\\n`),
    // the docker CLI on CI's Ubuntu runners adds a line of its own: what the
    // integration test found, a sweep that failed on a clean host
    dockerFailure('Error response from daemon: network qa-session-base not found\\nexit status 1\\n'),
  ]) {
    await createDocker({ execFileFn: recordingExec([err]) }).rmNetwork('gone')
  }"""),
    ("""    dockerFailure(`${LOGRUS_TTY}\\nError: no container with name or ID "a" found: no such container\\n`),
  ]) {
    await createDocker({ execFileFn: recordingExec([err]) }).rmForce(['a', 'b'])
  }""", """    dockerFailure(`${LOGRUS_TTY}\\nError: no container with name or ID "a" found: no such container\\n`),
    dockerFailure('Error response from daemon: No such container: a\\nexit status 1\\n'),
  ]) {
    await createDocker({ execFileFn: recordingExec([err]) }).rmForce(['a', 'b'])
  }"""),
])
print('ok')
