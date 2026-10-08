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
import { renderEnv } from '../session.mjs'

// A string names both networks by prefix (`<prefix>-base`, `<prefix>-pr`);
// `{ base, pr }` names them outright. Two panes on one network would undo the
// isolation, and so would Docker's own networks (`host`, `bridge`, `none`) or
// another container's (`container:<name>`): those are refused.
const NETWORK_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const DOCKER_NETWORKS = new Set(['host', 'bridge', 'none', 'default'])

function paneNetworks(network) {
  const networks = typeof network === 'string' && network
    ? { base: `${network}-base`, pr: `${network}-pr` }
    : { base: network?.base, pr: network?.pr }
  const named = name => typeof name === 'string' && NETWORK_NAME.test(name) && !DOCKER_NETWORKS.has(name)
  if (!named(networks.base) || !named(networks.pr) || networks.base === networks.pr) {
    throw new Error('network must be a prefix or { base, pr }: two different network names of letters, digits, _, . and -, none of Docker\'s own')
  }
  return Object.freeze(networks)
}

// An explicit password is shared by both panes; anything but a non-empty
// string (undefined means none) is a mistake.
function explicitPassword(password) {
  if (password !== undefined && (typeof password !== 'string' || password === '')) {
    throw new Error('postgres.password must be a non-empty string; leave it out for a password per pane')
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
}) {
  const networks = paneNetworks(network)
  const pgUser = { user: 'qa', db: 'postgres', ...postgres }
  const sharedPassword = explicitPassword(pgUser.password)
  const ensureOpts = registry ? { relogin: () => docker.login(registry.user, registry.token) } : {}
  const login = async () => {
    if (registry) await docker.login(registry.user, registry.token)
  }
  const pgName = role => `qa-pg-${role}`
  const appName = role => `qa-app-${role}`
  const migrateName = role => `qa-migrate-${role}`
  const envFile = role => `${workDir}/.env.qa-${role}`
  // The env carries prod-derived secrets: owner-only, and scrubbed on teardown.
  const writeEnv = async (role, env) => {
    const path = envFile(role)
    await fsx.writeFile(path, renderEnv(env ?? {}), { mode: 0o600 })
    return path
  }

  return {
    networks,

    async provisionDatabase({ paneRef, databases }) {
      const net = networks[paneRef.role]
      // One left over (teardown tolerates a failed removal) is reused; any
      // other failure, such as no address pool left, stops the boot here.
      await docker.createNetwork(net).catch(err => {
        if (!/already exists/.test(`${err.message ?? ''}\n${err.stderr ?? ''}`)) throw err
      })
      const pg = pgName(paneRef.role)
      const password = sharedPassword ?? randomBytes(24).toString('hex')
      await docker.runPg(pg, net, { password })
      await docker.waitHealthyPg(pg, {})
      for (const d of databases) await docker.createDatabase(pg, d)
      const dsn = `postgresql://${pgUser.user}:${password}@${pg}:5432`
      // query handle = docker-exec psql; the topology stays inside this adapter.
      // query takes an optional {database} so adapters can target a specific
      // logical DB (an app's sign-in tables may live in a database of their own).
      const db = { dsn, query: (sql, { database } = {}) => docker.psql(pg, database ?? pgUser.db, sql) }
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
    async runMigrate({ paneRef, migrate, env }) {
      await login()
      await docker.ensureImage(migrate.image, ensureOpts)
      const file = await writeEnv(paneRef.role, env.app ?? Object.values(env)[0])
      await docker.runMigrate(migrate.image, networks[paneRef.role], file, { name: migrateName(paneRef.role) })
    },

    async launchServices({ paneRef, services, env, reserved }) {
      await login()
      for (const [name, image] of Object.entries(services)) {
        await docker.ensureImage(image, ensureOpts)
        const file = await writeEnv(paneRef.role, env[name])
        await docker.runApp(appName(paneRef.role), image, networks[paneRef.role], file, reserved[name].port)
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

    // Startup: remove labelled orphans and both panes' networks from a
    // previous run, and the one shared network earlier versions made.
    async sweep() {
      await docker.sweepQaContainers()
      await docker.rmNetwork(networks.base)
      await docker.rmNetwork(networks.pr)
      if (typeof network === 'string') await docker.rmNetwork(network)
    },

    async teardown({ paneRef }) {
      // The migrate run too, which a teardown during migrating finds still
      // running: it would keep the network alive.
      await docker.rmForce([appName(paneRef.role), migrateName(paneRef.role), pgName(paneRef.role)])
      // This pane's own network; rmNetwork tolerates one already gone.
      await docker.rmNetwork(networks[paneRef.role])
      await fsx.unlink(envFile(paneRef.role)).catch(() => {})
    },
  }
}
