R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:80])
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/isolation.mjs', [
    ("""// What the runtime says before any check: never better than these, whatever
// a check finds. `host` is the address the conductor listens on (default
// 127.0.0.1), `platform` process.platform's value. `containers: false` (a
// Provisioner that runs none) leaves out what only containers' VMs say.
export function floors({ host = '127.0.0.1', platform, containers = true }) {
  const out = []
  if (platform === 'darwin' && containers) {""",
     """// What the runtime says before any check: never better than these, whatever
// a check finds. `host` is the address the conductor listens on (default
// 127.0.0.1), `platform` process.platform's value. `containers: false` (a
// Provisioner that runs none) leaves out what only containers' VMs say, and
// so does `internal: true` (#32): the PR pane is on a network with no route
// off itself, and the check's probe speaks for the VM's forwarding.
export function floors({ host = '127.0.0.1', platform, containers = true, internal = false }) {
  const out = []
  if (platform === 'darwin' && containers && internal !== true) {"""),
])

edit('lib/server.mjs', [
    ("""// better than the runtime's floors. QA_REQUIRE_ISOLATION refuses a session
// that isn't isolated: as it starts when that is known then (a declaration,
// no check, a floor), else before anything of the PR's runs.
const runtimeFloors = floors({ host, platform })
""", """// better than the runtime's floors. QA_REQUIRE_ISOLATION refuses a session
// that isn't isolated: as it starts when that is known then (a declaration,
// no check, a floor), else before anything of the PR's runs.
// A Provisioner that means to put the PR pane on an internal network (#32)
// says so (`internal: true`): the macOS floor then waits for its check, and
// holds unless the check's result says `internal: true` too.
const runtimeFloors = internal => floors({ host, platform, internal })
"""),
    ("""  const floorsNow = decl?.verdict === 'shared-host' ? floors({ host, platform, containers: false }) : runtimeFloors
  return { decl, build, known: [...(build ? [build] : []), ...floorsNow] }""",
     """  const floorsNow = decl?.verdict === 'shared-host' ? floors({ host, platform, containers: false }) : runtimeFloors(adapters.provisioner?.internal === true)
  return { decl, build, known: [...(build ? [build] : []), ...floorsNow] }"""),
    ("""  let result
  try {
    result = fromCheck(await adapters.provisioner.isolation({ signal, canary: { port: harness.address()?.port ?? cfg.ports.harness, ...mine } }))
  } catch (err) {""", """  let result
  // whether the check's result says the PR pane is on an internal network
  let internal = false
  try {
    const raw = await adapters.provisioner.isolation({ signal, canary: { port: harness.address()?.port ?? cfg.ports.harness, ...mine } })
    internal = raw?.internal === true
    result = fromCheck(raw)
  } catch (err) {"""),
    ("""  if (signal.aborted) return // superseded: the verdict is no session's
  const verdict = combine([result, ...known])""", """  if (signal.aborted) return // superseded: the verdict is no session's
  const verdict = combine([result, ...(build ? [build] : []), ...runtimeFloors(internal)])"""),
])
print('ok')
