R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:120], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/forwarder.mjs', [
    ("""        res.writeHead(upRes.statusCode, endToEnd(upRes.headers))
        upRes.pipe(res)
""", """        res.writeHead(upRes.statusCode, endToEnd(upRes.headers))
        // From here the PR's side is bounded too: once the host is done, a
        // PR that stops reading near the end would hold it with nothing
        // else to time it out. Node holds a socket's timeout off while
        // what is queued on it still moves, so a slow reader isn't cut.
        res.setTimeout(idleMs, () => reset(res.socket))
        upRes.pipe(res)
"""),
    ("""// Run in the container: the config from PANE_FORWARDER. A bad one exits 1.
// The Provisioner, finding no forwarder ready, then puts the PR pane on an
// ordinary network, and its isolation verdict says egress isn't restricted.
// Only when run as given to node -e ([eval]): imported, by the conductor
// say, it starts nothing, whatever its env.
if (typeof process !== 'undefined' && process.env.PANE_FORWARDER && /\\[eval\\d*\\]$/.test(import.meta.url)) {
  let config
  try {
    config = JSON.parse(process.env.PANE_FORWARDER)
  } catch {
    console.error('qa-forwarder: PANE_FORWARDER is not JSON')
    process.exit(1)
  }
  createForwarder(config).then(
    () => console.log('qa-forwarder ready'),
    err => { console.error(`qa-forwarder: ${err.message}`); process.exit(1) },
  )
}""", """// Run in the container: the config from PANE_FORWARDER. A bad one exits 1.
// The Provisioner, finding no forwarder ready, then puts the PR pane on an
// ordinary network, and its isolation verdict says egress isn't restricted.
// Every line goes to stdout, refusals included: triage's log tail
// (`logsTail`) reads stdout only.
// Only when run as given to node -e ([eval]): imported, by the conductor
// say, it starts nothing, whatever its env.
if (typeof process !== 'undefined' && process.env.PANE_FORWARDER && /\\[eval\\d*\\]$/.test(import.meta.url)) {
  let config
  try {
    config = JSON.parse(process.env.PANE_FORWARDER)
  } catch {
    console.log('qa-forwarder: PANE_FORWARDER is not JSON')
    process.exit(1)
  }
  createForwarder(config, { log: line => console.log(line) }).then(
    () => console.log('qa-forwarder ready'),
    err => { console.log(`qa-forwarder: ${err.message}`); process.exit(1) },
  )
}"""),
])

edit('lib/docker.mjs', [
    ("""export function createDocker({ execFileFn, label = DEFAULT_LABEL, postgres = DEFAULT_POSTGRES }) {""",
     """export function createDocker({ execFileFn, label = DEFAULT_LABEL, postgres = DEFAULT_POSTGRES, env = process.env }) {"""),
    ("""    // Where the CLI's daemon is: the current context's endpoint, which
    // DOCKER_HOST and DOCKER_CONTEXT set (unix://, npipe://, tcp://, ssh://).
    async endpoint() {
      return (await run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).trim()
    },""", """    // Where the CLI's daemon is: the current context's endpoint, which
    // DOCKER_HOST and DOCKER_CONTEXT set (unix://, npipe://, tcp://, ssh://).
    // With `podman` (`docker version` named Podman) and no endpoint from
    // the context, the CLI is Podman's (the podman-docker shim), which has
    // no Docker context: its own connection then, CONTAINER_HOST, else the
    // one CONTAINER_CONNECTION names, else the default connection, else
    // 'local' (no connection: Podman runs its containers on this host).
    async endpoint({ podman = false } = {}) {
      const context = await run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).then(out => out.trim(), err => {
        if (!podman) throw err
        return ''
      })
      if (!podman || /^[a-z][a-z0-9+.-]*:\\/\\//i.test(context)) return context
      if (env.CONTAINER_HOST) return env.CONTAINER_HOST
      const listed = JSON.parse(await run(['system', 'connection', 'list', '--format', 'json']) || 'null') ?? []
      if (!Array.isArray(listed)) throw new Error('podman system connection list gave no list')
      const named = env.CONTAINER_CONNECTION
      const connection = named ? listed.find(c => c?.Name === named) : listed.find(c => c?.Default === true)
      if (named && !connection) throw new Error(`CONTAINER_CONNECTION names ${JSON.stringify(named)}, which podman doesn't list`)
      return connection ? String(connection.URI ?? '') : 'local'
    },"""),
])

edit('lib/adapters/provisioner-docker.mjs', [
    ("""// it, a Docker Engine with CVE-2024-29018 (before 23.0.11, 25.0.0–25.0.4,
// 26.0.0-rc1–rc3) forwards them to a resolver on the host's loopback: a way
// out for data, in DNS queries.""", """// it, a Docker Engine without the fix for CVE-2024-29018 (23.0.11, 25.0.5,
// 26.0.0 and later) forwards them to a resolver on the host's loopback: a
// way out for data, in DNS queries."""),
    ("""    } catch (err) {
      if (err?.name === 'AbortError') throw err
      const failure = errorLine(err)""", """    } catch (err) {
      // an aborted boot undoes nothing: the next session may own these
      // names by now
      if (err?.name === 'AbortError' || signal?.aborted) throw aborted()
      const failure = errorLine(err)"""),
    ("""        topology = null
        topology = await internalNetwork(signal)""", """        topology = null
        // an aborted boot's topology is never taken for the next one's
        const t = await internalNetwork(signal)
        live(signal)
        topology = t"""),
    ("""    let endpoint
    try {
      endpoint = await docker.endpoint()
    } catch (err) {
      return cannotTell(`could not tell where the Docker daemon runs: ${errorLine(err)}`)
    }
    if (!/^(unix|npipe):\\/\\//i.test(endpoint)) {""", """    let endpoint
    try {
      endpoint = await docker.endpoint({ podman: /podman/i.test(runtime.version) })
    } catch (err) {
      return cannotTell(`could not tell where the Docker daemon runs: ${errorLine(err)}`)
    }
    if (endpoint !== 'local' && !/^(unix|npipe):\\/\\//i.test(endpoint)) {"""),
])
print('ok')
