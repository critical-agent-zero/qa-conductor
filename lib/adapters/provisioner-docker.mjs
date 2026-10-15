// Docker Provisioner adapter: the built-in Provisioner that runs each pane as
// containers (a postgres one and an app one) on the host's Docker daemon.
//
// It owns everything docker: the pane pg containers, each pane's network, the
// app containers, registry auth, the one-shot migrate run, the pane env files
// (mode 0600, under workDir), the startup orphan sweep and the failure log
// tails. The conductor core never touches docker. A managed-Postgres or
// process-based deployment provides a peer provisioner; the core and the other
// four seams are identical either way.
//
// The panes are kept apart: each pane's containers join a network of their
// own, so the PR pane's app can neither resolve nor reach the base pane's
// containers, and each pane's database gets a password of its own, drawn per
// boot, which only that pane's DSN carries. The core needs no shared network:
// it reaches the apps through their host ports and the databases through
// `docker exec`.
//
// Single-service per pane: each pane runs its services as `qa-app-<role>`
// with one env file; multi-service docker panes are a follow-up when a
// consumer needs them.
//
// Effects are injected (docker wrappers, fsx) so this is unit-tested against a
// recording docker mock with no real containers.

import { randomBytes } from 'node:crypto'
import { errorLine } from '../docker.mjs'
import { renderEnv } from '../session.mjs'

// A string names both networks by prefix (`<prefix>-base`, `<prefix>-pr`);
// `{ base, pr }` names them outright. Refused, since each would undo the
// isolation:
// - two panes on one network;
// - Docker's or Podman's own networks and network modes, which put a pane on
//   the host or beside other containers, and another container's
//   (`container:<name>`);
// - a name of lowercase hex digits, which Docker also reads as the start of a
//   network id (ids are lowercase), so `network rm` or `run --network` could
//   find some other network.
const NETWORK_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const OWN_NETWORKS = new Set([
  'host', 'bridge', 'none', 'default', 'ingress', 'docker_gwbridge',
  'podman', 'private', 'pasta', 'slirp4netns', 'podman-default-kube-network',
])
const idLike = name => /^[0-9a-f]+$/.test(name)
const networkName = name => typeof name === 'string' && NETWORK_NAME.test(name) && !OWN_NETWORKS.has(name) && !idLike(name)

function paneNetworks(network) {
  const networks = typeof network === 'string' && network
    ? { base: `${network}-base`, pr: `${network}-pr` }
    : { base: network?.base, pr: network?.pr }
  if (!networkName(networks.base) || !networkName(networks.pr) || networks.base === networks.pr) {
    throw new Error('network must be a prefix or { base, pr }: two different network names of letters, digits, _, . and -, not lowercase hex digits alone, and none of Docker\'s or Podman\'s own')
  }
  return Object.freeze(networks)
}

const aborted = () => Object.assign(new Error('boot aborted'), { name: 'AbortError' })

// `promise`, or UNSETTLED once `ms` have passed, whichever comes first. A
// late rejection is nobody's to handle. The timer is cleared as soon as
// either comes, and a boot's abort settles the run (runProbe's signal).
const UNSETTLED = Symbol('unsettled')
function settledWithin(promise, ms) {
  let timer
  const late = new Promise(resolve => { timer = setTimeout(resolve, ms, UNSETTLED) })
  promise.catch(() => {})
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

// Where a runtime gives a container the host, and so maybe the host's
// loopback: Docker Desktop's names and addresses, Podman's name, Lima's
// (colima, Rancher Desktop on Linux) name and fixed address, Rancher
// Desktop's name, gvproxy's (Podman machine), slirp4netns's, pasta's mapped
// gateway, and the default bridge's gateway. The PR network's own gateways
// join them.
const HOST_ADDRESSES = [
  'host.docker.internal', 'gateway.docker.internal', 'host.containers.internal', 'host.lima.internal', 'host.rancher-desktop.internal',
  '192.168.65.254', '192.168.65.2', '192.168.127.254', '192.168.5.2', '10.0.2.2', '169.254.1.2', '172.17.0.1',
]

// What the probe says on stderr, exiting 3, when its image lacks a tool it
// needs or has one that works otherwise.
const PROBE_NEEDS = 'the probe needs timeout, grep and cat, and a timeout that takes its seconds first'

// The isolation probe, run with bash in the postgres image on the PR pane's
// network: `probe <port> <path> <expect> <host>… -- <address:port>… --
// <own address:port>…`.
// - It checks its tools first, and stops (exit 3) when one is missing or
//   works otherwise: a failure inside the probing would go unseen, every
//   connect "failing".
// - For each host, an HTTP GET of <path> on <port>, which this conductor's
//   harness answers with <expect> (so another server there doesn't count):
//   `listener <host>`.
// - For each address, a TCP connect: `open <address:port>`.
// - For each own address (the PR pane's database), the same: `self
//   <address:port>`, its positive control. A probe that reaches nothing,
//   not even that, has shown nothing.
// All at once, each in at most 3 seconds, then `probe done`.
const PROBE_SCRIPT = [
  'port=$1 path=$2 expect=$3',
  'shift 3',
  `need() { echo '${PROBE_NEEDS}' >&2; exit 3; }`,
  'command -v timeout >/dev/null && command -v grep >/dev/null && command -v cat >/dev/null || need',
  'timeout 3 true 2>/dev/null || need',
  'printf \'%s\\n\' "$expect" | cat | grep -qF -- "$expect" 2>/dev/null || need',
  'hosts=() targets=() selves=() part=0',
  'for a in "$@"; do',
  '  if [ "$a" = -- ]; then part=$((part + 1))',
  '  elif [ "$part" = 0 ]; then hosts+=("$a")',
  '  elif [ "$part" = 1 ]; then targets+=("$a")',
  '  else selves+=("$a")',
  '  fi',
  'done',
  'listener() {',
  '  if timeout 3 bash -c \'exec 3<>"/dev/tcp/$1/$2" || exit 1; printf "GET %s HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n" "$3" >&3; cat <&3\' _ "$1" "$port" "$path" 2>/dev/null | grep -qF -- "$expect"; then',
  '    echo "listener $1"',
  '  fi',
  '}',
  'connects() {',
  '  if timeout 3 bash -c \'exec 3<>"/dev/tcp/$1/$2"\' _ "${1%:*}" "${1##*:}" 2>/dev/null; then',
  '    echo "$2 $1"',
  '  fi',
  '}',
  'for h in "${hosts[@]}"; do listener "$h" & done',
  'for t in "${targets[@]}"; do connects "$t" open & done',
  'for t in "${selves[@]}"; do connects "$t" self & done',
  'wait',
  'echo "probe done"',
].join('\n')

// An explicit password is shared by both panes; anything but a non-empty
// string without control characters (a line break would reach the env file)
// is a mistake. undefined means none.
function explicitPassword(password) {
  if (password !== undefined && (typeof password !== 'string' || password === '' || /[\0-\x1f\x7f]/.test(password))) {
    throw new Error('postgres.password must be a non-empty string without control characters; leave it out for a password per pane')
  }
  return password
}

export function createDockerProvisioner({
  docker,
  fsx,
  // directory the pane env files are written to (must be readable by the
  // docker daemon's `--env-file` path resolution, i.e. the conductor's cwd view)
  workDir,
  // the prefix of each pane's network, or { base, pr }
  network = 'qa-session',
  // The superuser in each pane's DSN; match createDocker's user and db. Leave
  // password out: each pane's database then gets its own, drawn per boot. An
  // explicit password is used for both panes. (createDocker's password never
  // reaches a pane: this provisioner always passes runPg one.)
  postgres = {},
  // per-role loopback host ports the app container publishes on
  hostPorts = { base: 3111, pr: 3112 },
  // registry credentials: log in before pulls, relogin on pull retry
  registry = null,
  // how long the isolation probe's docker run may take, in all
  probeTimeoutMs = 30_000,
}) {
  const networks = paneNetworks(network)
  // Keys set to undefined (an unset env var, say) keep their defaults.
  const given = Object.fromEntries(Object.entries(postgres ?? {}).filter(([, value]) => value !== undefined))
  const pgUser = { user: 'qa', db: 'postgres', ...given }
  const sharedPassword = explicitPassword(pgUser.password)
  const ensureOpts = registry ? { relogin: () => docker.login(registry.user, registry.token) } : {}
  const login = async () => {
    if (registry) await docker.login(registry.user, registry.token)
  }
  const pgName = role => `qa-pg-${role}`
  const appName = role => `qa-app-${role}`
  const migrateName = role => `qa-migrate-${role}`
  // the isolation probe, on the PR pane's network
  const probeName = 'qa-probe-pr'
  const networkOf = role => {
    if (!Object.hasOwn(networks, role)) throw new Error(`no network for role ${JSON.stringify(role)}: base or pr`)
    return networks[role]
  }
  // `network create` failed: carry on only if a network of that very name
  // exists (one teardown failed to remove). Other "already exists" errors, and
  // a name that only prefixes another network's id, don't count.
  const reuseNetwork = async (net, err) => {
    if (!/already exists|already used/.test(`${err.message ?? ''}\n${err.stderr ?? ''}`)) throw err
    const found = await docker.run(['network', 'inspect', '--format', '{{.Name}}', net]).catch(() => null)
    if (found?.trim() !== net) throw err
  }
  const envFile = role => `${workDir}/.env.qa-${role}`
  // The env carries prod-derived secrets: owner-only, and scrubbed on teardown
  // and at startup.
  const writeEnv = async (role, env) => {
    const path = envFile(role)
    await fsx.writeFile(path, renderEnv(env ?? {}), { mode: 0o600 })
    return path
  }
  // A teardown or takeover aborts the boot but can't stop a docker call in
  // flight, such as a pull. So before each step that creates or changes
  // something (a network, a container, an env file), stop if the boot was
  // aborted meanwhile: the next session may own this role's pane by now.
  const live = signal => {
    if (signal?.aborted) throw aborted()
  }

  return {
    networks,

    async provisionDatabase({ paneRef, databases, signal }) {
      const net = networkOf(paneRef.role)
      live(signal)
      // One left over is reused; any other failure, such as no address pool
      // left, stops the boot here.
      await docker.createNetwork(net).catch(err => reuseNetwork(net, err))
      const pg = pgName(paneRef.role)
      const password = sharedPassword ?? randomBytes(24).toString('hex')
      // Pulled first, so the container isn't created minutes later, after an
      // abort, by a `docker run` that had to pull.
      live(signal)
      await docker.ensurePgImage(ensureOpts)
      live(signal)
      await docker.runPg(pg, net, { password })
      await docker.waitHealthyPg(pg, {})
      for (const d of databases) {
        live(signal)
        await docker.createDatabase(pg, d)
      }
      // The core seeds this database next: not if the boot was aborted.
      live(signal)
      const dsn = `postgresql://${encodeURIComponent(pgUser.user)}:${encodeURIComponent(password)}@${pg}:5432`
      // query handle = docker-exec psql; the topology stays inside this adapter.
      // query takes an optional {database} so adapters can target a specific
      // logical DB (an app's sign-in tables may live in a database of their own).
      // A Seed or sign-in still running when the boot is aborted can't write
      // through it: by then the next session may own this pane's name.
      const db = {
        dsn,
        query: async (sql, { database } = {}) => {
          live(signal)
          return docker.psql(pg, database ?? pgUser.db, sql)
        },
      }
      return { dsn, db }
    },

    async reserveServices({ paneRef, services }) {
      // Docker host ports are deterministic per role, so reservation is pure:
      // assign the loopback url/port without starting anything.
      const port = hostPorts[paneRef.role]
      const out = {}
      for (const name of Object.keys(services)) out[name] = { url: `http://127.0.0.1:${port}`, port }
      return out
    },

    // One-shot migration: run the migrate image on the pane's network with
    // the same env the app will get. Pulls explicitly (retry + relogin) so a
    // transient registry hiccup can't half-fail a docker run.
    async runMigrate({ paneRef, migrate, env, signal }) {
      const net = networkOf(paneRef.role)
      live(signal)
      await login()
      live(signal)
      await docker.ensureImage(migrate.image, ensureOpts)
      live(signal)
      const file = await writeEnv(paneRef.role, env.app ?? Object.values(env)[0])
      live(signal)
      await docker.runMigrate(migrate.image, net, file, { name: migrateName(paneRef.role) })
    },

    async launchServices({ paneRef, services, env, reserved, signal }) {
      const net = networkOf(paneRef.role)
      live(signal)
      await login()
      for (const [name, image] of Object.entries(services)) {
        live(signal)
        await docker.ensureImage(image, ensureOpts)
        live(signal)
        const file = await writeEnv(paneRef.role, env[name])
        live(signal)
        await docker.runApp(appName(paneRef.role), image, net, file, reserved[name].port)
      }
    },

    async waitHealthy({ services }) {
      for (const svc of Object.values(services)) if (svc.port) await docker.waitHealthyApp(svc.port, {})
    },

    // Failure triage: the app container once it exists, the pg container before.
    async logs({ paneRef, stage, lines = 40 }) {
      const container = stage === 'starting' ? appName(paneRef.role) : pgName(paneRef.role)
      return docker.logsTail(container, lines)
    },

    // Startup: remove both panes' env files (which hold an earlier run's env
    // and passwords; first, so a daemon that isn't up yet doesn't keep them),
    // labelled orphans, both panes' networks, and the one shared network
    // earlier versions made under the prefix's name. That one goes only if
    // it carries the conductor's label, as theirs did, and Docker can't take
    // the name for one of its own or for an id's start.
    // Each step runs whatever the one before did; the first failure rejects
    // once all have run. A daemon that isn't up fails at `docker ps`, before
    // anything else can.
    async sweep() {
      for (const role of ['base', 'pr']) await fsx.unlink(envFile(role)).catch(() => {})
      await docker.sweepQaContainers().then(() => {}, err => err).then(async containers => {
        const failures = [containers]
        for (const name of [networks.base, networks.pr]) failures.push(await docker.rmNetwork(name).then(() => {}, err => err))
        if (typeof network === 'string' && networkName(network)) failures.push(await docker.rmLabelledNetwork(network).then(() => {}, err => err))
        const failure = failures.find(err => err !== undefined)
        if (failure !== undefined) throw failure
      })
    },

    // Whether the PR pane can reach the base pane (README, Security), checked
    // once both panes' databases exist and before the PR's migrate or app
    // runs. The runtime first: Podman doesn't keep its networks apart, and
    // Docker Desktop forwards the host's loopback, where the base app is
    // published. Then a probe on the PR pane's network: can it reach this
    // conductor at an address that leads to the host's loopback (`canary`:
    // the harness port, a path, and what the harness answers there), or the
    // base pane's database? Its own pane's database is its positive control:
    // a probe that can't reach even that has shown nothing. Anything it can't
    // tell is unknown, never isolated.
    async isolation({ signal, canary }) {
      live(signal)
      // The probe's output: its hits, whether its control hit, and whether
      // it finished.
      const readProbe = text => {
        const lines = typeof text === 'string' ? text.split('\n').map(line => line.trim()) : []
        const hits = []
        let control = false
        for (const line of lines) {
          const [kind, where] = line.split(' ')
          if (kind === 'listener' && where) hits.push(`the PR pane reached this conductor at ${where}:${canary.port}, so it can reach the host's loopback, where the base app is published`)
          if (kind === 'open' && where) hits.push(`the PR pane reached the base pane's database at ${where}`)
          if (kind === 'self' && where) control = true
        }
        return { hits, control, done: lines.includes('probe done') }
      }
      // reachable when the runtime already says so, else unknown, saying why
      const found = []
      const cannotTell = reason => ({ verdict: found.length ? 'reachable' : 'unknown', reasons: [...found, reason] })
      let runtime
      try {
        runtime = await docker.runtime()
      } catch (err) {
        return cannotTell(`could not tell the container runtime: ${errorLine(err)}`)
      }
      // Known from `docker version` alone, behind the podman-docker shim too,
      // whose info and network formats differ.
      if (/podman/i.test(runtime.version)) return { verdict: 'reachable', reasons: ['Podman\'s networks don\'t keep one pane\'s containers from the other\'s'] }
      if (runtime.osError) return cannotTell(`could not tell the container runtime: ${errorLine(runtime.osError)}`)
      // The probe speaks for this host's loopback only when the daemon runs
      // here: one on another host publishes the pane apps there.
      let endpoint
      try {
        endpoint = await docker.endpoint()
      } catch (err) {
        return cannotTell(`could not tell where the Docker daemon runs: ${errorLine(err)}`)
      }
      if (!/^(unix|npipe):\/\//i.test(endpoint)) {
        let where = 'an unknown endpoint'
        try { const u = new URL(endpoint); where = `${u.protocol}//${u.hostname}` } catch { /* shown as unknown */ }
        return cannotTell(`the Docker daemon is at ${where}, not on this host, so the probe can't speak for this host's loopback`)
      }
      if (/docker desktop/i.test(runtime.os)) found.push('Docker Desktop forwards host.docker.internal to the host\'s loopback, where the base app is published')
      // every address each database has, on every network it joined
      const databaseOf = async role => {
        const addresses = await docker.containerAddresses(pgName(role))
        if (addresses.length === 0) throw new Error(`${pgName(role)} has none`)
        return addresses.map(address => `${address}:5432`)
      }
      let gateways
      let baseDbs
      let ownDbs
      try {
        gateways = await docker.networkGateways(networks.pr)
        baseDbs = await databaseOf('base')
        ownDbs = await databaseOf('pr')
      } catch (err) {
        return cannotTell(`could not find the panes' addresses: ${errorLine(err)}`)
      }
      const hosts = [...new Set([...HOST_ADDRESSES, ...gateways])]
      // docker run killed at probeTimeoutMs, or not settled a little after
      // (an exec that ignores its timeout): the container may still be up
      const timedOut = async () => {
        await docker.rmForce([probeName]).catch(() => {})
        const within = probeTimeoutMs >= 1000 ? `${Math.round(probeTimeoutMs / 1000)} s` : `${probeTimeoutMs} ms`
        return cannotTell(`the probe didn't finish within ${within}, so it can't say what the PR pane reaches`)
      }
      let out
      try {
        live(signal)
        const run = docker.runProbe(probeName, networks.pr, PROBE_SCRIPT, [String(canary.port), canary.path, canary.expect, ...hosts, '--', ...baseDbs, '--', ...ownDbs], { timeoutMs: probeTimeoutMs, signal })
        out = await settledWithin(run, probeTimeoutMs + Math.min(2000, probeTimeoutMs))
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        // what it found before it failed or was killed still counts
        found.push(...readProbe(err?.stdout).hits)
        if (err?.killed) return timedOut()
        return cannotTell(`the probe couldn't run: ${errorLine(err)}`)
      }
      if (out === UNSETTLED) return timedOut()
      const { hits, control, done } = readProbe(out)
      found.push(...hits)
      if (!done) return cannotTell('the probe didn\'t finish, so it can\'t say what the PR pane reaches')
      // a hit shows itself; a miss means something only once the control hit
      if (hits.length === 0 && !control) {
        return cannotTell(`the probe couldn't reach the PR pane's own database at ${ownDbs.join(', ')}, so what it didn't reach proves nothing`)
      }
      return found.length ? { verdict: 'reachable', reasons: found } : { verdict: 'isolated', reasons: [] }
    },

    // Rejects when a container or the network may still be up, after trying
    // every step: the conductor opens enrolment only once a teardown left no
    // pane running (README, Security).
    async teardown({ paneRef }) {
      // The migrate run too, which a teardown during migrating finds still
      // running: it would keep the network alive. And the PR pane's probe.
      const names = [appName(paneRef.role), migrateName(paneRef.role), ...(paneRef.role === 'pr' ? [probeName] : []), pgName(paneRef.role)]
      const containers = await docker.rmForce(names).then(() => {}, err => err)
      // This pane's own network; rmNetwork tolerates one already gone.
      const net = await docker.rmNetwork(networkOf(paneRef.role)).then(() => {}, err => err)
      await fsx.unlink(envFile(paneRef.role)).catch(() => {})
      const failure = containers ?? net
      if (failure !== undefined) throw failure
    },
  }
}
