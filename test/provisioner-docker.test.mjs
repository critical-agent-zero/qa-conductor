// The Docker Provisioner keeps the panes apart: each pane's containers join a
// network of their own, and each pane's database has a password of its own
// that only that pane's DSN carries. These tests boot a real session over the
// real Docker wrapper, with a recording execFileFn in place of the docker CLI
// (argv and env), and a recording fsx in place of the env files. No Docker
// daemon runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDocker } from '../lib/docker.mjs'
import { createDockerProvisioner } from '../lib/adapters/provisioner-docker.mjs'
import { bootSession, migrateImageFor, teardownSession } from '../lib/session.mjs'

const BASE_IMG = 'ghcr.io/x/app:1.0.0-rc.38'
const PR_IMG = 'ghcr.io/x/app:pr-7-abcdef123456'
const WORK = '/work'
const PASSWORD = /^[0-9a-f]{48}$/

// Every docker CLI call, with the env it was given; image inspect answers, so
// nothing is pulled. `answer(args, opts)` may return (or resolve to) an Error for a call to reject
// with, or a string for its stdout.
function recordingExec({ answer = () => null } = {}) {
  const calls = []
  const fn = async (file, args, opts = {}) => {
    calls.push({ file, args, env: opts.env ?? null, timeout: opts.timeout ?? null, killSignal: opts.killSignal ?? null, signal: opts.signal ?? null })
    const out = await answer(args, opts)
    if (out instanceof Error) throw out
    return { stdout: out ?? '' }
  }
  fn.calls = calls
  return fn
}

function recordingFs() {
  const files = new Map()
  const removed = []
  return {
    files,
    removed,
    writeFile: async (path, text, opts) => { files.set(path, { text, mode: opts?.mode }) },
    unlink: async path => { removed.push(path) },
  }
}

// The real wrapper, with its health waits answered at once (they poll with
// sleeps); every other member runs as written.
function makeDocker(exec) {
  const docker = createDocker({ execFileFn: exec })
  const ensureImage = docker.ensureImage
  return Object.assign(docker, {
    waitHealthyPg: async () => {},
    waitHealthyApp: async () => {},
    // the real pull and retry, without the 3 s sleep between tries
    ensureImage(image, opts = {}) { return ensureImage.call(this, image, { ...opts, sleepFn: async () => {} }) },
  })
}

function makeSession({ provisionerOptions = {}, answer } = {}) {
  const exec = recordingExec({ answer })
  const fsx = recordingFs()
  const provisioner = createDockerProvisioner({ docker: makeDocker(exec), fsx, workDir: WORK, ...provisionerOptions })
  const dsns = {}
  const deps = {
    adapters: {
      provisioner,
      build: {
        migrationStrategy: 'one-shot-image',
        ensureBuilt: async () => {},
        resolveBaseImages: async () => ({ services: { app: BASE_IMG }, migrate: { image: migrateImageFor(BASE_IMG) } }),
        resolvePrImages: async () => ({ services: { app: PR_IMG }, migrate: { image: migrateImageFor(PR_IMG) } }),
      },
      seed: { databases: ['app'], seedPane: async () => {} },
      envTransform: {
        derivePaneEnv: ({ pane }) => {
          dsns[pane.ref.role] = pane.dsn
          return { app: { DATABASE_URL: pane.dsn } }
        },
      },
      auth: { requiresDb: false, establishSession: async ({ pane }) => ({ landingUrl: `/login-${pane.ref.role}`, cookies: [] }) },
    },
    env: { operatorEmail: 'op@example.com', paneOrigins: { base: 'http://127.0.0.1:3101', pr: 'http://127.0.0.1:3102' } },
    onProgress: () => {},
  }
  return { exec, fsx, provisioner, dsns, deps }
}

const docker = exec => exec.calls.filter(c => c.file === 'docker')
const runs = exec => docker(exec).filter(c => c.args[0] === 'run')
const valueOf = (args, flag) => {
  const at = args.indexOf(flag)
  return at === -1 ? null : args[at + 1]
}
// Which pane a docker run belongs to: its container name, else (a migrate
// run has none) the pane env file it reads.
const roleOf = args => {
  const name = valueOf(args, '--name') ?? valueOf(args, '--env-file')
  return /-(base|pr)$/.exec(name)?.[1] ?? null
}
const pgPassword = (exec, role) => {
  const call = runs(exec).find(c => valueOf(c.args, '--name') === `qa-pg-${role}`)
  return call.env?.POSTGRES_PASSWORD
}

test('each pane\'s containers join only that pane\'s network, and the two networks differ', async () => {
  const s = makeSession()
  await bootSession(s.deps, 7)
  const byRole = { base: new Set(), pr: new Set() }
  for (const { args } of runs(s.exec)) {
    const role = roleOf(args)
    assert.ok(role, `every docker run belongs to a pane: ${args.join(' ')}`)
    assert.equal(args.filter(a => a === '--network').length, 1, `one --network: ${args.join(' ')}`)
    byRole[role].add(valueOf(args, '--network'))
  }
  assert.deepEqual([...byRole.base], ['qa-session-base'])
  assert.deepEqual([...byRole.pr], ['qa-session-pr'])
  // postgres, the migrate run and the app, for each pane
  assert.equal(runs(s.exec).length, 6)
  // By image too, since the image is what holds PR code: each pane's images
  // run on its own network, with its own env file.
  const byImage = runs(s.exec).filter(c => !/^qa-pg-/.test(valueOf(c.args, '--name'))).map(c => [c.args.at(-1), valueOf(c.args, '--network'), valueOf(c.args, '--env-file')])
  assert.deepEqual(byImage, [
    [migrateImageFor(BASE_IMG), 'qa-session-base', `${WORK}/.env.qa-base`],
    [migrateImageFor(PR_IMG), 'qa-session-pr', `${WORK}/.env.qa-pr`],
    [BASE_IMG, 'qa-session-base', `${WORK}/.env.qa-base`],
    [PR_IMG, 'qa-session-pr', `${WORK}/.env.qa-pr`],
  ])
  // No container joins a second network afterwards: a boot creates networks, and nothing else.
  for (const { args } of docker(s.exec)) {
    if (args[0] === 'network') assert.equal(args[1], 'create', args.join(' '))
  }
  const created = docker(s.exec).filter(c => c.args[0] === 'network' && c.args[1] === 'create').map(c => c.args.at(-1))
  assert.deepEqual(created, ['qa-session-base', 'qa-session-pr'])
  assert.deepEqual(s.provisioner.networks, { base: 'qa-session-base', pr: 'qa-session-pr' })
  assert.ok(Object.isFrozen(s.provisioner.networks), 'networks can\'t be pointed at one network afterwards')
})

test('each pane\'s database gets its own password, never in argv, and only its own pane\'s DSN and env file carry it', async () => {
  const s = makeSession()
  await bootSession(s.deps, 7)
  const base = pgPassword(s.exec, 'base')
  const pr = pgPassword(s.exec, 'pr')
  assert.match(base, PASSWORD)
  assert.match(pr, PASSWORD)
  assert.notEqual(base, pr)
  // The value goes in the docker CLI's env, under a bare -e POSTGRES_PASSWORD.
  for (const role of ['base', 'pr']) {
    const { args, env } = runs(s.exec).find(c => valueOf(c.args, '--name') === `qa-pg-${role}`)
    assert.ok(args.includes('POSTGRES_PASSWORD'), 'a bare -e POSTGRES_PASSWORD')
    assert.ok(env.PATH !== undefined || process.env.PATH === undefined, 'the CLI keeps the conductor\'s env')
  }
  for (const { args } of s.exec.calls) {
    for (const secret of [base, pr]) assert.ok(!args.join(' ').includes(secret), `no password in argv: ${args.join(' ')}`)
  }
  // Only the postgres runs get a password in their env.
  for (const c of s.exec.calls) {
    if (c.env?.POSTGRES_PASSWORD === undefined) continue
    assert.ok(c.file === 'docker' && c.args[0] === 'run' && /^qa-pg-/.test(valueOf(c.args, '--name')), 'only runPg passes a password')
  }
  assert.equal(s.dsns.base, `postgresql://qa:${base}@qa-pg-base:5432`)
  assert.equal(s.dsns.pr, `postgresql://qa:${pr}@qa-pg-pr:5432`)
  const baseEnv = s.fsx.files.get(`${WORK}/.env.qa-base`)
  const prEnv = s.fsx.files.get(`${WORK}/.env.qa-pr`)
  assert.equal(baseEnv.mode, 0o600)
  assert.equal(prEnv.mode, 0o600)
  assert.ok(baseEnv.text.includes(base) && !baseEnv.text.includes(pr), 'the base env file holds the base password only')
  assert.ok(prEnv.text.includes(pr) && !prEnv.text.includes(base), 'the PR env file holds the PR password only')
})

test('every boot draws new passwords, and each boot\'s DSNs carry that boot\'s', async () => {
  const s = makeSession()
  const dsns = []
  for (let boot = 0; boot < 2; boot++) {
    await bootSession(s.deps, 7)
    dsns.push(s.dsns.base, s.dsns.pr)
  }
  const passwords = runs(s.exec).filter(c => /^qa-pg-/.test(valueOf(c.args, '--name') ?? '')).map(c => c.env.POSTGRES_PASSWORD)
  assert.equal(passwords.length, 4)
  assert.equal(new Set(passwords).size, 4)
  assert.deepEqual(dsns.map(dsn => new URL(dsn).password), passwords)
})

test('teardown removes each pane\'s own network, and sweep removes both and the shared one earlier versions made', async () => {
  const s = makeSession()
  await bootSession(s.deps, 7)
  const before = docker(s.exec).length
  await teardownSession({ provisioner: s.provisioner })
  const teardown = docker(s.exec).slice(before).map(c => c.args.join(' '))
  // The migrate run is named too, so a teardown during migrating removes it,
  // and with it the last endpoint that would keep the network alive.
  assert.deepEqual(runs(s.exec).filter(c => c.args.includes('--rm')).map(c => valueOf(c.args, '--name')), ['qa-migrate-base', 'qa-migrate-pr'])
  assert.deepEqual(teardown, [
    'rm -f -v qa-app-base qa-migrate-base qa-pg-base',
    'network rm qa-session-base',
    'rm -f -v qa-app-pr qa-migrate-pr qa-probe-pr qa-pg-pr',
    'network rm qa-session-pr',
  ])
  assert.deepEqual(s.fsx.removed, [`${WORK}/.env.qa-base`, `${WORK}/.env.qa-pr`])

  // The shared network 0.3.1 made carries the conductor's label: sweep
  // removes a network of the prefix's name only then, never one of yours.
  const labelled = names => args => args[0] === 'network' && args[1] === 'ls' ? names : null
  const swept = recordingExec({ answer: labelled('qa-session\nqa-session-base\n') })
  const sweptFs = recordingFs()
  const fresh = createDockerProvisioner({ docker: makeDocker(swept), fsx: sweptFs, workDir: WORK })
  await fresh.sweep()
  assert.deepEqual(docker(swept).map(c => c.args.join(' ')), [
    'ps -aq --filter label=qa-conductor-session',
    'network rm qa-session-base',
    'network rm qa-session-pr',
    'network ls --filter label=qa-conductor-session --format {{.Name}}',
    'network rm qa-session',
  ])
  // The env files an earlier run left behind hold its passwords.
  assert.deepEqual(sweptFs.removed, [`${WORK}/.env.qa-base`, `${WORK}/.env.qa-pr`])
  const yours = recordingExec({ answer: labelled('qa-session-base\nqa-session-x\n') })
  await createDockerProvisioner({ docker: makeDocker(yours), fsx: recordingFs(), workDir: WORK }).sweep()
  assert.ok(!docker(yours).some(c => c.args.join(' ') === 'network rm qa-session'), 'an unlabelled network of that name is left alone')

  // A prefix Docker could take for one of its own networks, or for the start
  // of a network id, is fine for the pane networks, but sweep leaves that
  // name itself alone.
  for (const prefix of ['host', 'bridge', 'cafe']) {
    const exec = recordingExec({ answer: labelled(`${prefix}\n`) })
    const p = createDockerProvisioner({ docker: makeDocker(exec), fsx: recordingFs(), workDir: WORK, network: prefix })
    assert.deepEqual(p.networks, { base: `${prefix}-base`, pr: `${prefix}-pr` })
    await p.sweep()
    assert.deepEqual(docker(exec).map(c => c.args.join(' ')).slice(1), [`network rm ${prefix}-base`, `network rm ${prefix}-pr`], prefix)
  }

  // The env files go first, and a missing one is fine: a daemon that isn't up
  // yet fails the sweep, but not before the passwords are gone.
  const down = recordingExec({ answer: args => args[0] === 'ps' ? Object.assign(new Error('docker ps: Command failed'), { stderr: 'Cannot connect to the Docker daemon' }) : null })
  const enoent = { ...recordingFs(), removed: [] }
  enoent.unlink = async file => { enoent.removed.push(file); throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' }) }
  await assert.rejects(createDockerProvisioner({ docker: makeDocker(down), fsx: enoent, workDir: WORK }).sweep(), /docker ps/)
  assert.deepEqual(enoent.removed, [`${WORK}/.env.qa-base`, `${WORK}/.env.qa-pr`])
  await createDockerProvisioner({ docker: makeDocker(recordingExec()), fsx: enoent, workDir: WORK }).sweep()
})

// The conductor lets a browser enrol only once a teardown has left no pane
// running, so a container or network docker couldn't remove must fail the
// teardown, or the sweep, rather than pass for gone.
test('teardown and sweep reject when docker can\'t remove a container or network, after trying every step', async () => {
  const fail = stderr => Object.assign(new Error(`docker: Command failed\n${stderr}`), { stderr })
  const stuck = args => {
    if (args[0] === 'rm') return fail('Error response from daemon: cannot remove container "/qa-app-pr": could not kill: permission denied\n')
    if (args[0] === 'network' && args[1] === 'rm') return fail('Error response from daemon: error while removing network: network qa-session-pr id 3f2 has active endpoints\n')
    if (args[0] === 'ps') return 'c0ffee\n'
    return null
  }
  const s = makeSession({ answer: stuck })
  const out = await teardownSession({ provisioner: s.provisioner })
  assert.equal(out.ok, false)
  assert.deepEqual(out.failed.map(f => f.role), ['base', 'pr'])
  assert.match(out.failed[1].message, /could not kill/)
  // every step was still tried: the network, and the env file with its password
  assert.deepEqual(docker(s.exec).map(c => c.args.join(' ')), [
    'rm -f -v qa-app-base qa-migrate-base qa-pg-base', 'network rm qa-session-base',
    'rm -f -v qa-app-pr qa-migrate-pr qa-probe-pr qa-pg-pr', 'network rm qa-session-pr',
  ])
  assert.deepEqual(s.fsx.removed, [`${WORK}/.env.qa-base`, `${WORK}/.env.qa-pr`])

  const sweptExec = recordingExec({ answer: stuck })
  await assert.rejects(createDockerProvisioner({ docker: makeDocker(sweptExec), fsx: recordingFs(), workDir: WORK }).sweep(), /could not kill/)
  assert.deepEqual(docker(sweptExec).map(c => c.args.join(' ')).slice(0, 4), [
    'ps -aq --filter label=qa-conductor-session', 'rm -f -v c0ffee', 'network rm qa-session-base', 'network rm qa-session-pr',
  ])

  // a pane that never came up is fine: docker reports each name missing
  const gone = makeSession({ answer: args => (args[0] === 'rm' ? fail('Error response from daemon: No such container: qa-app-base\n') : args[1] === 'rm' ? fail('Error: No such network: qa-session-base\n') : null) })
  assert.deepEqual(await teardownSession({ provisioner: gone.provisioner }), { ok: true, failed: [] })
})

// On a clean start, and after any teardown, both pane networks are already
// gone. Podman says so in its own words, through its CLI or its compat API.
// Taking that for a failure would fail every startup sweep, and enrolment
// would never open.
test('on Podman, sweep and teardown take containers and networks already gone for gone', async () => {
  const fail = stderr => Object.assign(new Error(`docker: Command failed\n${stderr}`), { stderr })
  // the podman-docker shim writes its banner first, on every call
  const banner = 'Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.\n'
  const podman = {
    cli: { first: '', missing: name => `Error: unable to find network with name or ID ${name}: network not found\n` },
    shim: { first: banner, missing: name => `Error: unable to find network with name or ID ${name}: network not found\n` },
    compat: { first: '', missing: () => 'Error response from daemon: network not found\n' },
  }
  for (const [via, { first, missing }] of Object.entries(podman)) {
    const answer = args => {
      if (args[0] === 'ps') return 'c0ffee\n'
      if (args[0] === 'rm') return fail(`${first}Error: no container with name or ID "${args.at(-1)}" found: no such container\n`)
      if (args[0] === 'network' && args[1] === 'rm') return fail(`${first}${missing(args[2])}`)
      if (args[0] === 'network' && args[1] === 'ls') return ''
      return null
    }
    const exec = recordingExec({ answer })
    await createDockerProvisioner({ docker: makeDocker(exec), fsx: recordingFs(), workDir: WORK }).sweep()
    assert.deepEqual(docker(exec).filter(c => c.args[1] === 'rm').map(c => c.args.join(' ')), ['network rm qa-session-base', 'network rm qa-session-pr'], via)

    const s = makeSession({ answer })
    assert.deepEqual(await teardownSession({ provisioner: s.provisioner }), { ok: true, failed: [] }, via)
  }
})

test('network as a prefix or as { base, pr }; two panes on one network are refused', async () => {
  const prefixed = makeSession({ provisionerOptions: { network: 'widget-qa' } })
  await bootSession(prefixed.deps, 7)
  assert.deepEqual(prefixed.provisioner.networks, { base: 'widget-qa-base', pr: 'widget-qa-pr' })
  assert.deepEqual(new Set(runs(prefixed.exec).map(c => `${roleOf(c.args)} ${valueOf(c.args, '--network')}`)), new Set(['base widget-qa-base', 'pr widget-qa-pr']))

  const named = makeSession({ provisionerOptions: { network: { base: 'blue', pr: 'green' } } })
  await bootSession(named.deps, 7)
  assert.deepEqual(new Set(runs(named.exec).map(c => `${roleOf(c.args)} ${valueOf(c.args, '--network')}`)), new Set(['base blue', 'pr green']))
  const swept = recordingExec()
  await createDockerProvisioner({ docker: makeDocker(swept), fsx: recordingFs(), workDir: WORK, network: { base: 'blue', pr: 'green' } }).sweep()
  assert.deepEqual(docker(swept).map(c => c.args.join(' ')).slice(1), ['network rm blue', 'network rm green'])

  for (const network of [
    { base: 'one', pr: 'one' }, { base: 'one' }, { base: '', pr: 'two' }, '', 7, null,
    // Docker's and Podman's own networks and modes would put a pane on the
    // host or beside other containers.
    { base: 'host', pr: 'two' }, { base: 'one', pr: 'bridge' }, { base: 'none', pr: 'two' }, { base: 'one', pr: 'default' },
    { base: 'podman', pr: 'two' }, { base: 'one', pr: 'ingress' }, { base: 'docker_gwbridge', pr: 'two' }, { base: 'one', pr: 'container:qa-app-base' },
    { base: 'private', pr: 'two' }, { base: 'one', pr: 'pasta' }, { base: 'slirp4netns', pr: 'two' }, { base: 'one', pr: 'podman-default-kube-network' },
    // Lowercase hex: Docker would read it as the start of some other network's id.
    { base: 'a', pr: 'two' }, { base: 'one', pr: '1' }, { base: 'cafe', pr: 'two' },
    { base: 'one', pr: 'two words' }, '-dash', 'a/b',
  ]) {
    assert.throws(() => createDockerProvisioner({ docker: makeDocker(recordingExec()), fsx: recordingFs(), workDir: WORK, network }), /network/, JSON.stringify(network))
  }
  // Network ids are lowercase, so an uppercase name can't be taken for one.
  assert.deepEqual(createDockerProvisioner({ docker: makeDocker(recordingExec()), fsx: recordingFs(), workDir: WORK, network: { base: 'CAFE', pr: 'DB' } }).networks, { base: 'CAFE', pr: 'DB' })
  // a role other than base or pr has no network
  const s = makeSession()
  await assert.rejects(s.provisioner.provisionDatabase({ paneRef: { role: 'other' }, databases: [] }), /role/)
  assert.equal(docker(s.exec).length, 0)
})

const failure = stderr => Object.assign(new Error('docker network: Command failed'), { stderr })
const createFails = stderr => args => args[0] === 'network' && args[1] === 'create' ? failure(stderr) : null

test('a pane network that already exists by that very name is reused; any other failure to create one fails the boot', async () => {
  // Docker says so, and an inspect by name finds that very network.
  const exists = makeSession({
    answer: args => createFails('Error response from daemon: network with name qa-session-base already exists')(args)
      ?? (args[0] === 'network' && args[1] === 'inspect' ? `${args.at(-1)}\n` : null),
  })
  await bootSession(exists.deps, 7)
  assert.equal(runs(exists.exec).length, 6)
  assert.deepEqual(docker(exists.exec).filter(c => c.args[0] === 'network' && c.args[1] === 'inspect').map(c => c.args.join(' ')), [
    'network inspect --format {{.Name}} qa-session-base',
    'network inspect --format {{.Name}} qa-session-pr',
  ])

  for (const [why, answer] of [
    ['no address pool left', createFails('Error response from daemon: could not find an available, non-overlapping IPv4 address pool among the defaults to assign to the network')],
    // Another "already exists", and no network of that name.
    ['an iptables chain', args => createFails('Error response from daemon: Chain already exists')(args) ?? (args[1] === 'inspect' ? failure('Error: No such network: qa-session-base') : null)],
    // Only a network whose id starts with the name.
    ['another network\'s id', args => createFails('Error response from daemon: network with name qa-session-base already exists')(args) ?? (args[1] === 'inspect' ? 'some-other-network\n' : null)],
    // A failure that isn't about the name, though such a network exists.
    ['an unrelated failure', args => createFails('permission denied while trying to connect to the Docker daemon socket')(args) ?? (args[1] === 'inspect' ? `${args.at(-1)}\n` : null)],
  ]) {
    const s = makeSession({ answer })
    await assert.rejects(s.provisioner.provisionDatabase({ paneRef: { role: 'base' }, databases: [] }), err => err.message === 'docker network: Command failed', why)
    assert.equal(runs(s.exec).length, 0, `${why}: no container starts without its network`)
  }
})

test('an explicit postgres password is used for both panes, and other postgres keys keep their defaults', async () => {
  const s = makeSession({ provisionerOptions: { postgres: { password: 'hunter2' } } })
  await bootSession(s.deps, 7)
  assert.equal(pgPassword(s.exec, 'base'), 'hunter2')
  assert.equal(pgPassword(s.exec, 'pr'), 'hunter2')
  assert.equal(s.dsns.base, 'postgresql://qa:hunter2@qa-pg-base:5432')
  assert.equal(s.dsns.pr, 'postgresql://qa:hunter2@qa-pg-pr:5432')
  // the networks still keep them apart
  assert.deepEqual(s.provisioner.networks, { base: 'qa-session-base', pr: 'qa-session-pr' })
  // a postgres option without user or db keeps 'qa' and 'postgres'
  const { db } = await s.provisioner.provisionDatabase({ paneRef: { role: 'base' }, databases: [] })
  await db.query('SELECT 1')
  assert.deepEqual(docker(s.exec).at(-1).args, ['exec', 'qa-pg-base', 'psql', '-U', 'qa', '-d', 'postgres', '-t', '-A', '-c', 'SELECT 1'])

  // The old default, given explicitly, is an explicit password like any other.
  const qa = makeSession({ provisionerOptions: { postgres: { user: 'qa', password: 'qa', db: 'postgres' } } })
  await bootSession(qa.deps, 7)
  assert.deepEqual([pgPassword(qa.exec, 'base'), pgPassword(qa.exec, 'pr')], ['qa', 'qa'])

  // An explicit password must be a non-empty string with no control
  // characters (a line break would reach the env file); undefined means none.
  for (const password of ['', 42, false, null, 'two\nlines', 'tab\there', 'nul\0']) {
    assert.throws(() => createDockerProvisioner({ docker: makeDocker(recordingExec()), fsx: recordingFs(), workDir: WORK, postgres: { password } }), /postgres\.password/, JSON.stringify(password))
  }
  const unset = makeSession({ provisionerOptions: { postgres: { password: undefined } } })
  await bootSession(unset.deps, 7)
  assert.notEqual(pgPassword(unset.exec, 'base'), pgPassword(unset.exec, 'pr'))

  // The DSN encodes the user and password, so a URL parser reads them back.
  const odd = makeSession({ provisionerOptions: { postgres: { user: 'qa:user', password: 'p@ss:w/rd#1%?$&+,' } } })
  await bootSession(odd.deps, 7)
  assert.equal(pgPassword(odd.exec, 'base'), 'p@ss:w/rd#1%?$&+,')
  assert.equal(odd.dsns.base, 'postgresql://qa%3Auser:p%40ss%3Aw%2Frd%231%25%3F%24%26%2B%2C@qa-pg-base:5432')
  const url = new URL(odd.dsns.base)
  assert.deepEqual([decodeURIComponent(url.username), decodeURIComponent(url.password), url.host], ['qa:user', 'p@ss:w/rd#1%?$&+,', 'qa-pg-base:5432'])

  // postgres: null is no postgres at all.
  const none = makeSession({ provisionerOptions: { postgres: null } })
  await bootSession(none.deps, 7)
  assert.match(none.dsns.base, /^postgresql:\/\/qa:[0-9a-f]{48}@qa-pg-base:5432$/)

  // Keys present but undefined (an unset env var, say) keep their defaults.
  const unsetKeys = makeSession({ provisionerOptions: { postgres: { user: undefined, db: undefined, password: undefined } } })
  await bootSession(unsetKeys.deps, 7)
  assert.match(unsetKeys.dsns.base, /^postgresql:\/\/qa:[0-9a-f]{48}@qa-pg-base:5432$/)
  const { db: unsetDb } = await unsetKeys.provisioner.provisionDatabase({ paneRef: { role: 'base' }, databases: [] })
  await unsetDb.query('SELECT 1')
  assert.deepEqual(docker(unsetKeys.exec).at(-1).args.slice(5, 7), ['-d', 'postgres'])

  const widget = makeSession({ provisionerOptions: { postgres: { user: 'widget', db: 'maindb' } } })
  await bootSession(widget.deps, 7)
  assert.match(widget.dsns.base, /^postgresql:\/\/widget:[0-9a-f]{48}@qa-pg-base:5432$/)
  assert.match(widget.dsns.pr, /^postgresql:\/\/widget:[0-9a-f]{48}@qa-pg-pr:5432$/)
  assert.notEqual(pgPassword(widget.exec, 'base'), pgPassword(widget.exec, 'pr'))
  // db.query uses the provisioner's db by default
  const { db: widgetDb } = await widget.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] })
  await widgetDb.query('SELECT 1')
  assert.deepEqual(docker(widget.exec).at(-1).args.slice(0, 6), ['exec', 'qa-pg-pr', 'psql', '-U', 'qa', '-d'])
  assert.equal(docker(widget.exec).at(-1).args[6], 'maindb')
})

// A torn-down or taken-over session aborts its boot, but a boot may be in the
// middle of a pull that takes minutes. Once that returns, the stale boot must
// not write the next session's env file or start a container on its network.
test('an aborted boot starts no container and writes no env file once it was aborted, even mid-pull', async () => {
  for (const [stage, image] of [['migrate', migrateImageFor(PR_IMG)], ['app', PR_IMG]]) {
    const controller = new AbortController()
    // The pull of that image is where the abort lands.
    const s = makeSession({
      answer: args => {
        if (args[0] === 'image' && args[1] === 'inspect' && args[2] === image) controller.abort()
        return null
      },
    })
    s.deps.signal = controller.signal
    await assert.rejects(bootSession(s.deps, 7), err => err.name === 'AbortError', stage)
    const prRuns = runs(s.exec).filter(c => roleOf(c.args) === 'pr' && !/^qa-pg-/.test(valueOf(c.args, '--name')))
    const after = stage === 'migrate' ? [] : [migrateImageFor(PR_IMG)]
    assert.deepEqual(prRuns.map(c => c.args.at(-1)), after, `${stage}: no PR run after the abort`)
    if (stage === 'migrate') assert.ok(!s.fsx.files.has(`${WORK}/.env.qa-pr`), 'no PR env file written after the abort')
  }
  // Already aborted: no call at all, not a registry login, not a pull, and
  // no env file.
  const controller = new AbortController()
  controller.abort()
  const s = makeSession({ provisionerOptions: { registry: { user: 'acme-bot', token: 't0ken' } } })
  for (const call of steps(controller.signal)) await assert.rejects(call(s.provisioner), err => err.name === 'AbortError')
  assert.deepEqual(s.exec.calls, [])
  assert.equal(s.fsx.files.size, 0)

  // Aborted while the step before runs: nothing after it happens.
  const PG_RUN = args => args[0] === 'run' && valueOf(args, '--name') === 'qa-pg-base'
  const LOGIN = args => args[0] === '-c' && args[1].includes('docker login')
  for (const [when, step, abortOn, after, options] of [
    ['the network is created', 0, args => args[0] === 'network' && args[1] === 'create', c => c.args[0] === 'run' || c.args[0] === 'image'],
    // The postgres image is pulled before its container is created, so an
    // abort can land between the two.
    ['the postgres image is pulled', 0, args => args[0] === 'image' && args[2] === 'postgres:16', c => c.args[0] === 'run'],
    ['postgres starts', 0, PG_RUN, c => c.args[0] === 'exec' && c.args.includes('CREATE DATABASE app')],
    // The last step: the call still rejects, so the core never seeds it.
    ['the last database is created', 0, args => args.includes('CREATE DATABASE app'), () => false],
    ['the registry login for the migrate image', 1, LOGIN, c => c.args[0] === 'image' || c.write, { registry: { user: 'acme-bot', token: 't0ken' } }],
    ['the registry login for the app image', 2, LOGIN, c => c.args[0] === 'image' || c.write, { registry: { user: 'acme-bot', token: 't0ken' } }],
    ['the migrate image is pulled', 1, args => args[0] === 'image', c => c.args[0] === 'run' || c.write],
    ['the migrate env file is written', 1, args => args[0] === 'write', c => c.args[0] === 'run'],
    ['the app image is pulled', 2, args => args[0] === 'image', c => c.args[0] === 'run' || c.write],
    ['the app env file is written', 2, args => args[0] === 'write', c => c.args[0] === 'run'],
  ]) {
    const ctl = new AbortController()
    const log = []
    const s2 = makeSession({ provisionerOptions: options, answer: args => { log.push({ args, after: ctl.signal.aborted }); if (abortOn(args)) ctl.abort(); return null } })
    const write = s2.fsx.writeFile
    s2.fsx.writeFile = async (file, text, opts) => {
      log.push({ args: ['write', file], write: true, after: ctl.signal.aborted })
      await write(file, text, opts)
      if (abortOn(['write'])) ctl.abort()
    }
    await assert.rejects(steps(ctl.signal)[step](s2.provisioner), err => err.name === 'AbortError', when)
    assert.ok(ctl.signal.aborted, `${when}: the abort happened`)
    assert.deepEqual(log.filter(c => c.after && after(c)).map(c => c.args.join(' ')), [], `${when}: nothing after the abort`)
  }
})

// A Seed (or a sign-in with requiresDb) already running when the boot is
// aborted writes through db.query: once aborted, the handle refuses, so it
// can't write into whatever database now answers to the pane's name.
test('an aborted boot\'s db handle refuses queries, so a Seed still running writes nothing more', async () => {
  const controller = new AbortController()
  const s = makeSession()
  s.deps.signal = controller.signal
  let afterAbort = null
  s.deps.adapters.seed.seedPane = async ({ db, signal }) => {
    assert.equal(signal, controller.signal, 'the Seed gets the boot\'s signal')
    await db.query('SELECT 1')
    controller.abort()
    afterAbort = docker(s.exec).length
    // It rejects rather than throwing, for a Seed that chains .then/.catch.
    let write
    assert.doesNotThrow(() => { write = db.query('INSERT INTO t VALUES (1)') })
    await assert.rejects(write, err => err.name === 'AbortError')
    await assert.rejects(db.query('SELECT 2', { database: 'app' }), err => err.name === 'AbortError')
  }
  await assert.rejects(bootSession(s.deps, 7), err => err.name === 'AbortError')
  assert.equal(docker(s.exec).length, afterAbort, 'no docker call after the abort')
  assert.ok(!docker(s.exec).some(c => c.args.join(' ').includes('INSERT')), 'the write never ran')
})

// The postgres image is pulled before its container is created, with the
// registry's relogin on a failed pull, as the app images are.
test('provisionDatabase pulls the postgres image before running it, relogging in before a retry', async () => {
  const s = makeSession()
  await bootSession(s.deps, 7)
  const calls = docker(s.exec).map(c => c.args.join(' '))
  const inspect = calls.indexOf('image inspect postgres:16')
  const run = calls.findIndex(c => c.startsWith('run ') && c.includes('--name qa-pg-base'))
  assert.ok(inspect !== -1 && run !== -1 && inspect < run, `image inspect postgres:16 (${inspect}) before run qa-pg-base (${run})`)

  // Missing image, a failed first pull: docker login comes before the retry.
  let pulls = 0
  const r = makeSession({
    provisionerOptions: { registry: { user: 'acme-bot', token: 't0ken' } },
    answer: args => {
      if (args[0] === 'image' && args[2] === 'postgres:16') return new Error('No such image')
      if (args[0] === 'pull' && args[1] === 'postgres:16' && pulls++ === 0) return new Error('denied')
      return null
    },
  })
  await r.provisioner.provisionDatabase({ paneRef: { role: 'base' }, databases: [] })
  const seq = r.exec.calls.map(c => c.file === 'sh' ? 'login' : c.args.slice(0, 2).join(' '))
  const firstPull = seq.indexOf('pull postgres:16')
  const secondPull = seq.indexOf('pull postgres:16', firstPull + 1)
  assert.ok(firstPull !== -1 && secondPull > firstPull, seq.join(' | '))
  assert.ok(seq.slice(firstPull + 1, secondPull).includes('login'), `a login between the pulls: ${seq.join(' | ')}`)
})

// The three provisioner steps that create or change something, for the base pane.
function steps(signal) {
  return [
    p => p.provisionDatabase({ paneRef: { role: 'base' }, databases: ['app'], signal }),
    p => p.runMigrate({ paneRef: { role: 'base' }, migrate: { image: migrateImageFor(BASE_IMG) }, env: { app: {} }, signal }),
    p => p.launchServices({ paneRef: { role: 'base' }, services: { app: BASE_IMG }, env: { app: {} }, reserved: { app: { port: 3111 } }, signal }),
  ]
}

// --- #29: the isolation probe ----------------------------------------------------
// Once both panes' databases exist, before anything of the PR's runs, a
// container on the PR pane's network tries to reach this conductor at every
// address a runtime gives the host's loopback (the harness answers a canary
// path with a nonce), and the base pane's database by address.

const CANARY = { port: 3100, path: '/__qa/canary/n0nce', expect: 'qa-canary n0nce' }

// The docker CLI the probe meets; each value may be an Error to fail with.
// By default the probe reaches nothing but the PR pane's own database, its
// positive control.
function probeDocker({
  version = 'Server: Docker Engine - Community\n', os = 'Ubuntu 24.04.1 LTS\n', gateway = '172.20.0.1 \n',
  base = '172.19.0.2 \n', pr = '172.20.0.3 \n', probe = 'self 172.20.0.3:5432\nprobe done\n', endpoint = 'unix:///var/run/docker.sock\n',
} = {}) {
  return (args, opts) => {
    if (args[0] === 'version') return version
    if (args[0] === 'info') return os
    if (args[0] === 'context' && args[1] === 'inspect') return endpoint
    if (args[0] === 'network' && args[1] === 'inspect') return gateway
    if (args[0] === 'inspect') return args.at(-1) === 'qa-pg-pr' ? pr : base
    if (args[0] === 'run' && args.includes('qa-probe-pr')) return typeof probe === 'function' ? probe(opts) : probe
    return null
  }
}

const probeRun = exec => runs(exec).find(c => valueOf(c.args, '--name') === 'qa-probe-pr')
// The probe's own arguments: port, path, expected body, the host addresses,
// `--`, the addresses it only connects to, `--`, then its own pane's
// database, which it must reach.
const probeArgs = call => call.args.slice(call.args.indexOf('probe') + 1)

test('the probe runs on the PR network once both databases exist and before any migrate, gone when done, with no ports, mounts or capabilities', async () => {
  const s = makeSession({ answer: probeDocker() })
  const verdicts = []
  s.deps.checkIsolation = async ({ stage, signal }) => {
    if (stage === 'panes') verdicts.push(await s.provisioner.isolation({ signal, canary: CANARY }))
  }
  await bootSession(s.deps, 7)
  assert.deepEqual(verdicts, [{ verdict: 'isolated', reasons: [] }])
  const calls = docker(s.exec).map(c => c.args.join(' '))
  const at = calls.findIndex(c => c.startsWith('run ') && c.includes('--name qa-probe-pr'))
  for (const before of ['network create --label qa-conductor-session qa-session-pr', 'run -d --name qa-pg-base', 'run -d --name qa-pg-pr']) {
    const i = calls.findIndex(c => c.startsWith(before))
    assert.ok(i !== -1 && i < at, `${before} (${i}) before the probe (${at})`)
  }
  const firstMigrate = calls.findIndex(c => c.includes('--name qa-migrate-'))
  assert.ok(firstMigrate > at, `the probe (${at}) before any migrate (${firstMigrate})`)

  const { args } = probeRun(s.exec)
  assert.equal(args[1], '--rm')
  assert.equal(valueOf(args, '--network'), 'qa-session-pr')
  assert.equal(valueOf(args, '--label'), 'qa-conductor-session')
  assert.equal(valueOf(args, '--cap-drop'), 'ALL')
  for (const flag of ['-p', '--publish', '-v', '--volume', '--mount', '--env-file', '-e', '--privileged']) assert.equal(args.includes(flag), false, flag)
  const own = probeArgs(probeRun(s.exec))
  assert.deepEqual(own.slice(0, 3), ['3100', '/__qa/canary/n0nce', 'qa-canary n0nce'])
  const sep = own.indexOf('--')
  const hosts = own.slice(3, sep)
  for (const host of [
    'host.docker.internal', 'gateway.docker.internal', 'host.containers.internal', '192.168.65.254', '192.168.127.254', '10.0.2.2', '172.20.0.1',
    // Lima (colima, Rancher Desktop on Linux): its name, its fixed host
    // address, and Rancher Desktop's name
    'host.lima.internal', '192.168.5.2', 'host.rancher-desktop.internal',
  ]) assert.ok(hosts.includes(host), host)
  assert.deepEqual(own.slice(sep + 1), ['172.19.0.2:5432', '--', '172.20.0.3:5432'], 'the base pane\'s database, then the PR pane\'s own, by address')
  assert.equal(probeRun(s.exec).timeout, 30_000)

  // every address the base database has, on every network it joined
  const multi = makeSession({ answer: probeDocker({ base: '172.19.0.2 10.9.0.4 \n', pr: '172.20.0.3 10.8.0.5 \n' }) })
  await multi.provisioner.isolation({ canary: CANARY })
  const multiArgs = probeArgs(probeRun(multi.exec))
  assert.deepEqual(multiArgs.slice(multiArgs.indexOf('--') + 1), ['172.19.0.2:5432', '10.9.0.4:5432', '--', '172.20.0.3:5432', '10.8.0.5:5432'])

  // a dual-stack network: the IPv6 addresses too, as targets and as the control
  const dual = makeSession({ answer: probeDocker({ base: '172.19.0.2 fd00:19::2 \n', pr: '172.20.0.3 fd00:20::3 \n' }) })
  await dual.provisioner.isolation({ canary: CANARY })
  const dualArgs = probeArgs(probeRun(dual.exec))
  assert.deepEqual(dualArgs.slice(dualArgs.indexOf('--') + 1), ['172.19.0.2:5432', 'fd00:19::2:5432', '--', '172.20.0.3:5432', 'fd00:20::3:5432'])
})

test('the probe\'s verdict: reachable on any hit, unknown when it can\'t tell, isolated otherwise', async () => {
  const podmanInfo = Object.assign(new Error('docker info: Command failed'), {
    stderr: 'Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.\nError: template: info:1:2: executing "info" at <.OperatingSystem>: can\'t evaluate field OperatingSystem in type *define.Info\n',
  })
  const dual = { base: '172.19.0.2 fd00:19::2 \n', pr: '172.20.0.3 fd00:20::3 \n' }
  const cases = [
    [{}, 'isolated', []],
    // The probe must show it could reach something, its own pane's
    // database: tools missing or broken in the image (no /dev/tcp, say)
    // print `probe done` and nothing else.
    [{ probe: 'probe done\n' }, 'unknown', [/^the probe couldn't reach the PR pane's own database over IPv4 \(172\.20\.0\.3:5432\), so its IPv4 misses prove nothing$/]],
    [{ probe: 'listener 10.0.2.2\nprobe done\n' }, 'reachable', [/10\.0\.2\.2:3100/]],
    [{ pr: '\n' }, 'unknown', [/^could not find the panes' addresses: qa-pg-pr has none/]],
    // a preflight that finds a tool missing ends the run before any probing
    [{ probe: Object.assign(new Error('docker run: Command failed'), { stderr: 'the probe needs timeout, grep and cat, and a timeout that takes its seconds first\n' }) }, 'unknown', [/^the probe couldn't run: the probe needs timeout, grep and cat/]],
    // a run that didn't end in time
    [{ probe: Object.assign(new Error('docker run: Command failed'), { killed: true, signal: 'SIGTERM' }) }, 'unknown', [/^the probe didn't finish within 30 s/]],
    // the podman-docker shim: no OperatingSystem in its info, and a banner
    [{ version: 'Client: Podman Engine\nVersion: 5.2.0\n', os: podmanInfo }, 'reachable', [/^Podman's networks don't keep one pane's containers from the other's/]],
    [{ os: podmanInfo }, 'unknown', [/^could not tell the container runtime: Error: template: info/]],
    [{ probe: 'listener host.docker.internal\nself 172.20.0.3:5432\nprobe done\n' }, 'reachable', [/^the PR pane reached this conductor at host\.docker\.internal:3100, so it can reach the host's loopback, where the base app is published/]],
    [{ probe: 'open 172.19.0.2:5432\nself 172.20.0.3:5432\nprobe done\n' }, 'reachable', [/^the PR pane reached the base pane's database at 172\.19\.0\.2:5432/]],
    [{ probe: 'listener 10.0.2.2\nopen 172.19.0.2:5432\nself 172.20.0.3:5432\nprobe done\n' }, 'reachable', [/10\.0\.2\.2:3100/, /172\.19\.0\.2:5432/]],
    // a hit before it stopped still counts
    [{ probe: 'listener 10.0.2.2\n' }, 'reachable', [/10\.0\.2\.2:3100/, /^the probe didn't finish/]],
    [{ os: 'Docker Desktop\n', probe: new Error('no bash') }, 'reachable', [/^Docker Desktop/, /^the probe couldn't run: no bash/]],
    [{ probe: '' }, 'unknown', [/^the probe didn't finish/]],
    [{ probe: new Error('docker run: Command failed: exec: "bash": executable file not found in $PATH') }, 'unknown', [/^the probe couldn't run: .*bash/]],
    [{ os: 'Docker Desktop\n' }, 'reachable', [/^Docker Desktop forwards host\.docker\.internal to the host's loopback/]],
    [{ version: 'Client: Podman Engine\nServer: Podman Engine\n' }, 'reachable', [/^Podman's networks don't keep one pane's containers from the other's/]],
    [{ os: new Error('Cannot connect to the Docker daemon') }, 'unknown', [/^could not tell the container runtime: Cannot connect/]],
    [{ gateway: new Error('No such network') }, 'unknown', [/^could not find the panes' addresses: No such network/]],
    [{ base: '\n' }, 'unknown', [/^could not find the panes' addresses: qa-pg-base has none/]],
    // no daemon to ask at all
    [{ version: new Error('Cannot connect to the Docker daemon') }, 'unknown', [/^could not tell the container runtime: Cannot connect/]],
    // A daemon on another host publishes the pane apps there, not on this
    // conductor's loopback: the probe can't speak for them. Only the scheme
    // and host are shown.
    [{ endpoint: 'tcp://10.0.0.5:2376\n' }, 'unknown', [/^the Docker daemon is at tcp:\/\/10\.0\.0\.5, which may not be this host, so the probe can't speak for this host's loopback$/]],
    [{ endpoint: 'ssh://me@build-box\n' }, 'unknown', [/^the Docker daemon is at ssh:\/\/build-box, which may not be this host/]],
    [{ endpoint: 'npipe:////./pipe/docker_engine\n' }, 'isolated', []],
    // Dual-stack: each family's misses count only once its own control hit.
    // An IPv4 self hit vouches for nothing over IPv6, nor the reverse.
    [{ ...dual, probe: 'self 172.20.0.3:5432\nprobe done\n' }, 'unknown', [/^the probe couldn't reach the PR pane's own database over IPv6 \(fd00:20::3:5432\), so its IPv6 misses prove nothing$/]],
    [{ ...dual, probe: 'self fd00:20::3:5432\nprobe done\n' }, 'unknown', [/^the probe couldn't reach the PR pane's own database over IPv4 \(172\.20\.0\.3:5432\), so its IPv4 misses prove nothing$/]],
    [{ ...dual, probe: 'self 172.20.0.3:5432\nself fd00:20::3:5432\nprobe done\n' }, 'isolated', []],
    [{ ...dual, probe: 'open fd00:19::2:5432\nself 172.20.0.3:5432\nprobe done\n' }, 'reachable', [/fd00:19::2:5432/]],
    [{ endpoint: new Error('unknown command "context"') }, 'unknown', [/^could not tell where the Docker daemon runs: unknown command/]],
    // a hit in a run that then failed or was killed still counts
    [{ probe: Object.assign(new Error('docker run: Command failed'), { killed: true, signal: 'SIGKILL', stdout: 'listener 10.0.2.2\n' }) }, 'reachable', [/10\.0\.2\.2:3100/, /^the probe didn't finish within 30 s/]],
    [{ probe: Object.assign(new Error('docker run: Command failed'), { code: 1, stdout: 'open 172.19.0.2:5432\n', stderr: 'boom\n' }) }, 'reachable', [/172\.19\.0\.2:5432/, /^the probe couldn't run: boom/]],
  ]
  for (const [docker, verdict, reasons] of cases) {
    const s = makeSession({ answer: probeDocker(docker) })
    const out = await s.provisioner.isolation({ canary: CANARY })
    assert.equal(out.verdict, verdict, JSON.stringify(docker))
    assert.equal(out.reasons.length, reasons.length, `${JSON.stringify(docker)}: ${out.reasons.join(' | ')}`)
    reasons.forEach((re, i) => assert.match(out.reasons[i], re, JSON.stringify(docker)))
  }
})

test('the probe doesn\'t run once the boot is aborted, and a teardown removes one still running', async () => {
  const s = makeSession({ answer: probeDocker() })
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(s.provisioner.isolation({ signal: ac.signal, canary: CANARY }), err => err.name === 'AbortError')
  assert.equal(probeRun(s.exec), undefined)
  // nor once it is aborted while the probe's addresses are looked up
  const late = new AbortController()
  const lookup = probeDocker()
  const t = makeSession({ answer: args => { if (args[0] === 'inspect') late.abort(); return lookup(args) } })
  await assert.rejects(t.provisioner.isolation({ signal: late.signal, canary: CANARY }), err => err.name === 'AbortError')
  assert.equal(probeRun(t.exec), undefined)
  await s.provisioner.teardown({ paneRef: { role: 'pr' } })
  assert.deepEqual(docker(s.exec).map(c => c.args.join(' ')).at(-2), 'rm -f -v qa-app-pr qa-migrate-pr qa-probe-pr qa-pg-pr')
})

// The probe's script, run here with bash against loopback listeners: one that
// answers the canary, one that answers something else, a port that's open
// and one that's closed.
test('the probe script reports the listener that answers the canary and the address that accepts a connection, and finishes', async () => {
  const { createServer } = await import('node:http')
  const net = await import('node:net')
  const { execFile } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const s = makeSession({ answer: probeDocker() })
  await s.provisioner.isolation({ canary: CANARY })
  const call = probeRun(s.exec)
  const script = valueOf(call.args, '-c')

  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
  const canary = createServer((req, res) => res.end(req.url === CANARY.path ? `${CANARY.expect}\n` : 'nope'))
  const other = createServer((req, res) => res.end('some other server'))
  const open = net.createServer(socket => socket.end())
  const closed = net.createServer()
  const [canaryPort, otherPort, openPort, closedPort] = [await listen(canary), await listen(other), await listen(open), await listen(closed)]
  await new Promise(resolve => closed.close(resolve)) // nothing listens there now
  // `timeout` comes with the probe image's coreutils; macOS has none
  const shim = mkdtempSync(join(tmpdir(), 'qa-probe-'))
  writeFileSync(join(shim, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n')
  chmodSync(join(shim, 'timeout'), 0o755)
  const runScript = (port, targets, selves = [`127.0.0.1:${openPort}`]) => new Promise((resolve, reject) => {
    execFile('bash', ['-c', script, 'probe', String(port), CANARY.path, CANARY.expect, '127.0.0.1', '--', ...targets, '--', ...selves], {
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}` }, timeout: 20_000,
    }, (err, stdout) => {
      if (err) return reject(err)
      // `probe done` comes last: in a --rm container, nothing still running
      // when bash exits gets to report
      const lines = stdout.split('\n').filter(Boolean)
      if (lines.at(-1) !== 'probe done') return reject(new Error(`probe done is not last:\n${stdout}`))
      resolve(lines.sort())
    })
  })
  try {
    assert.deepEqual(await runScript(canaryPort, [`127.0.0.1:${openPort}`, `127.0.0.1:${closedPort}`]), [
      'listener 127.0.0.1', `open 127.0.0.1:${openPort}`, 'probe done', `self 127.0.0.1:${openPort}`,
    ])
    assert.deepEqual(await runScript(otherPort, []), ['probe done', `self 127.0.0.1:${openPort}`], 'another server on the port is no hit')
    assert.deepEqual(await runScript(closedPort, [`127.0.0.1:${closedPort}`]), ['probe done', `self 127.0.0.1:${openPort}`])
    assert.deepEqual(await runScript(closedPort, [], [`127.0.0.1:${closedPort}`]), ['probe done'], 'its own database not reached: no self line')
    // An IPv6 address goes bare, as `docker inspect` gives it: the script
    // splits the port off at the last colon. Written out in full, so a
    // split at the first colon would try host `0` instead. Where this host
    // has ::1.
    const open6 = net.createServer(socket => socket.end())
    const v6 = await new Promise(resolve => {
      open6.once('error', () => resolve(null))
      open6.listen(0, '::1', () => resolve(open6.address().port))
    })
    if (v6 !== null) {
      try {
        const full = `0:0:0:0:0:0:0:1:${v6}`
        assert.deepEqual(await runScript(closedPort, [full], [full]), [`open ${full}`, 'probe done', `self ${full}`])
      } finally { open6.close() }
    }
  } finally {
    for (const server of [canary, other, open]) server.close()
    rmSync(shim, { recursive: true, force: true })
  }
})

// The probe's image may lack a tool, or have one that works otherwise: no
// `timeout` (macOS has none), an old BusyBox one that wants `-t`, no `grep`.
// Each failure inside the script would otherwise go unseen: every connect
// "fails", and the probe ends in `probe done` with nothing found. So it
// checks its tools first and stops, which the verdict reads as unknown.
test('the probe script stops before probing when a tool it needs is missing or different, and the verdict is unknown', async () => {
  const { execFile } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, chmodSync, rmSync, symlinkSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, delimiter } = await import('node:path')
  const which = name => process.env.PATH.split(delimiter).map(dir => join(dir, name)).find(p => existsSync(p))
  const s = makeSession({ answer: probeDocker() })
  await s.provisioner.isolation({ canary: CANARY })
  const script = valueOf(probeRun(s.exec).args, '-c')

  const gnuTimeout = '#!/bin/sh\nshift\nexec "$@"\n'
  const oldBusyBox = '#!/bin/sh\n[ "$1" = -t ] || { echo "timeout: invalid option" >&2; exit 1; }\nshift 2\nexec "$@"\n'
  // a tool that is there but does nothing: the listener pipes through cat
  // into grep, so the preflight does too
  const silent = '#!/bin/sh\nexit 0\n'
  const finds = '#!/bin/sh\nexit 1\n'
  const kits = {
    'no timeout': { tools: ['cat', 'grep'] },
    'an old BusyBox timeout': { tools: ['cat', 'grep'], shims: { timeout: oldBusyBox } },
    'no grep': { tools: ['cat'], shims: { timeout: gnuTimeout } },
    'no cat': { tools: ['grep'], shims: { timeout: gnuTimeout } },
    'a cat that copies nothing': { tools: ['grep'], shims: { timeout: gnuTimeout, cat: silent } },
    'a grep that finds nothing': { tools: ['cat'], shims: { timeout: gnuTimeout, grep: finds } },
  }
  const dirs = []
  try {
    for (const [kit, { tools, shims = {} }] of Object.entries(kits)) {
      const dir = mkdtempSync(join(tmpdir(), 'qa-probe-kit-'))
      dirs.push(dir)
      for (const tool of ['bash', ...tools]) symlinkSync(which(tool), join(dir, tool))
      for (const [name, body] of Object.entries(shims)) { writeFileSync(join(dir, name), body); chmodSync(join(dir, name), 0o755) }
      const timeout = shims.timeout
      // what a shim execs to show it works
      if (timeout) symlinkSync(which('true'), join(dir, 'true'))
      const err = await new Promise(resolve => {
        execFile(join(dir, 'bash'), ['-c', script, 'probe', '3100', CANARY.path, CANARY.expect, '127.0.0.1', '--', '--', '127.0.0.1:1'], {
          env: { PATH: dir }, timeout: 20_000,
        }, (error, stdout, stderr) => resolve(Object.assign(error ?? new Error('exited 0'), { stdout, stderr })))
      })
      assert.equal(err.code, 3, `${kit}: ${err.message}`)
      assert.doesNotMatch(err.stdout, /probe done/, kit)
      assert.match(err.stderr, /^the probe needs timeout, grep and cat, and a timeout that takes its seconds first/, kit)
      // as docker run reports it, the verdict
      const t = makeSession({ answer: probeDocker({ probe: Object.assign(new Error('docker run: Command failed'), { stderr: err.stderr }) }) })
      const out = await t.provisioner.isolation({ canary: CANARY })
      assert.equal(out.verdict, 'unknown', kit)
    }
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  }
})

// The docker CLI under a wedged daemon, or passing SIGTERM on to a bash
// that ignores it: a real child that ignores SIGTERM, run with the options
// runProbe gives, through the real exec wrapper.
test('a probe that doesn\'t finish within its time is killed and its container removed, and the verdict is unknown', async () => {
  const { makeExecFileFn } = await import('../lib/exec.mjs')
  const stubborn = opts => makeExecFileFn()(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 20000)"], opts).then(r => r.stdout, err => err)
  const s = makeSession({ answer: probeDocker({ probe: stubborn }), provisionerOptions: { probeTimeoutMs: 300 } })
  const began = Date.now()
  const out = await s.provisioner.isolation({ canary: CANARY })
  assert.ok(Date.now() - began < 5_000, `${Date.now() - began} ms`)
  assert.deepEqual(out, { verdict: 'unknown', reasons: ['the probe didn\'t finish within 300 ms, so it can\'t say what the PR pane reaches'] })
  assert.deepEqual([probeRun(s.exec).timeout, probeRun(s.exec).killSignal], [300, 'SIGKILL'])
  assert.equal(docker(s.exec).at(-1).args.join(' '), 'rm -f -v qa-probe-pr')

  // an exec that never settles at all is bounded too
  const never = makeSession({ answer: probeDocker({ probe: () => new Promise(() => {}) }), provisionerOptions: { probeTimeoutMs: 100 } })
  const stuck = await never.provisioner.isolation({ canary: CANARY })
  assert.equal(stuck.verdict, 'unknown')
  assert.match(stuck.reasons[0], /^the probe didn't finish within 100 ms/)
  assert.equal(docker(never.exec).at(-1).args.join(' '), 'rm -f -v qa-probe-pr')

  // 30 s unless told otherwise, said in seconds; and the boot's signal goes along
  const ac = new AbortController()
  const plain = makeSession({ answer: probeDocker() })
  await plain.provisioner.isolation({ signal: ac.signal, canary: CANARY })
  assert.deepEqual([probeRun(plain.exec).timeout, probeRun(plain.exec).signal], [30_000, ac.signal])
  const late = makeSession({ answer: probeDocker({ probe: Object.assign(new Error('docker run: Command failed'), { killed: true, signal: 'SIGKILL' }) }) })
  assert.match((await late.provisioner.isolation({ canary: CANARY })).reasons[0], /^the probe didn't finish within 30 s/)
})

// A teardown or takeover mid-probe aborts it: the run stops, and the boot
// with it (the PR pane's teardown removes the container).
test('a probe aborted mid-run rejects as aborted', async () => {
  const ac = new AbortController()
  const s = makeSession({
    answer: probeDocker({
      probe: opts => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })))),
    }),
  })
  const running = s.provisioner.isolation({ signal: ac.signal, canary: CANARY })
  setTimeout(() => ac.abort(), 20)
  await assert.rejects(running, err => err.name === 'AbortError')
})
