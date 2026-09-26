// Process Provisioner adapter: runs each pane's services, and optionally one
// database per pane, as local processes on the conductor's machine.
//
// The consumer's `command` (and `database.command`) says how to start each
// one. Every process starts detached, so it leads its own process group, with
// an env of exactly PATH plus what the pane declares: none of the conductor's
// own env (its GitHub token, HOME, cloud credentials) reaches a PR's code.
//
// Cleanup acts on process groups, never on bare pids, because a wrapper can
// exit at once while the server it started lives on. Every spawn is recorded
// in `${stateDir}/pids.json` with the leader's start time (from ps), so a
// later sweep can tell an orphaned group of ours from an unrelated process
// that has reused the pid.
//
// The env scrubbing and the loopback host are defence in depth only. The
// BuildConvention's trust gate is the one real boundary between a PR's code
// and this machine: these processes run as the conductor's user.
//
// Every effect (spawn, kill, ps, fetch, the free-port lookup, fs, sleep, the
// clock and the exit hook) is injected with a real default, so the tests
// start no processes.

import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import { StringDecoder } from 'node:string_decoder'

const PROBE_MS = 100
const KILL_WAIT_MS = 2000
const ATTEMPT_MAX_MS = 2000
const RETRY_MS = 250
const PORT_ATTEMPTS = 20
const MAX_LINE = 8192
const TAIL_LINES = 40

const never = new Promise(() => {})

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

// kill(-pid) signals a whole group. -1 would signal every process we may
// signal and -0 our own group, so only pids above 1 are ever used.
const killablePid = pid => Number.isSafeInteger(pid) && pid > 1

const startError = (name, cmd, cwd, err) =>
  new Error(`${name}: failed to start ${cmd} in ${cwd ?? '.'}: ${err?.message ?? err}`)

function describeExit({ error, code, signal }) {
  if (error) return error.message
  return signal ? `signal ${signal}` : `code ${code}`
}

// Settles (never rejects) once `signal` aborts, so it can sit in a race.
function whenAborted(signal) {
  if (!signal) return never
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
}

// --- real defaults ------------------------------------------------------------

// The optional signal clears the timer once a race no longer needs it.
function defaultSleep(ms, { signal } = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

function psText(args) {
  return new Promise((resolve, reject) => {
    execFile('ps', args, { env: { PATH: process.env.PATH, LC_ALL: 'C' } }, (err, stdout) => {
      if (err) reject(err)
      else resolve(String(stdout))
    })
  })
}

// The leader's start time, to the second: fixed for the life of a process, and
// different for any later process that reuses its pid.
async function defaultPs(pid) {
  try {
    const startedAt = (await psText(['-o', 'lstart=', '-p', String(pid)])).trim()
    return startedAt ? { startedAt } : null
  } catch (err) {
    if (err.code === 1) return null // ps exits 1 when there is no such process
    throw err
  }
}

async function defaultPgroup(pgid) {
  const members = []
  for (const line of (await psText(['-A', '-o', 'pid=,pgid='])).split('\n')) {
    const [pid, group] = line.trim().split(/\s+/).map(Number)
    if (group === pgid && Number.isSafeInteger(pid)) members.push(pid)
  }
  return members
}

function defaultFreePort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, host, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

const defaultFsx = {
  mkdir: fs.mkdir,
  lstat: fs.lstat,
  chmod: fs.chmod,
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  rename: fs.rename,
}

// --- the Provisioner ------------------------------------------------------------

export function createProcessProvisioner({
  // ({ name, ref, port, env, paneRef }) => { cmd, args, cwd, env? }
  command,
  // optional: { command({ paneRef, port }), ready({ port, signal }), handle({ paneRef, port }) => { dsn, db } }
  database = null,
  healthPath = '/',
  healthy = status => status < 500,
  healthTimeoutMs = 60000,
  // the pidfile's directory: created 0700, must be a real directory we own
  stateDir,
  // the address in reserved urls, health checks and the free-port lookup
  host = '127.0.0.1',
  graceMs = 5000,
  logLines = 200,
  spawnFn = spawn,
  killFn = (pid, sig) => process.kill(pid, sig),
  freePortFn = defaultFreePort,
  fetchFn = fetch,
  fsx = defaultFsx,
  psFn = defaultPs,
  pgroupFn = defaultPgroup,
  sleepFn = defaultSleep,
  nowFn = Date.now,
  onExitFn = fn => process.on('exit', fn),
  baseEnv = process.env,
  log = console,
} = {}) {
  if (typeof command !== 'function') throw new Error('createProcessProvisioner: command must be a function')
  if (typeof stateDir !== 'string' || !stateDir) throw new Error('createProcessProvisioner: stateDir is required')
  if (database && !['command', 'ready', 'handle'].every(k => typeof database[k] === 'function')) {
    throw new Error('createProcessProvisioner: database needs command, ready and handle functions')
  }

  const pidfile = `${stateDir}/pids.json`
  const urlHost = host.includes(':') ? `[${host}]` : host
  // role -> { procs, logs, ports, stale }. `procs` holds every process started
  // for the pane that isn't yet known to be gone.
  const panes = new Map()
  // Nothing binds a reserved port until launch, so the free-port lookup could
  // offer it again meanwhile; a port stays taken until its pane is torn down.
  const allocated = new Set()
  // service port -> its process, so waitHealthy can watch for an early exit
  const byPort = new Map()
  let exitHooked = false
  let dirReady = null
  let pidfileQueue = Promise.resolve()

  function pane(role) {
    let st = panes.get(role)
    if (!st) panes.set(role, (st = { procs: [], logs: [], ports: new Set(), stale: false }))
    return st
  }

  // --- state dir + pidfile ---

  function stateDirReady() {
    dirReady ??= checkStateDir().catch(err => {
      dirReady = null
      throw err
    })
    return dirReady
  }

  // The pidfile decides what gets killed, so its directory must be ours alone.
  async function checkStateDir() {
    await fsx.mkdir(stateDir, { recursive: true, mode: 0o700 })
    const st = await fsx.lstat(stateDir)
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`stateDir ${stateDir} must be a directory, not a symlink`)
    const uid = process.getuid?.()
    if (uid !== undefined && st.uid !== uid) throw new Error(`stateDir ${stateDir} must be owned by uid ${uid}, not ${st.uid}`)
    if (st.mode & 0o077) await fsx.chmod(stateDir, 0o700)
  }

  async function readPidfile() {
    try {
      const list = JSON.parse(String(await fsx.readFile(pidfile, 'utf8')))
      return Array.isArray(list) ? list.filter(e => e && typeof e === 'object') : []
    } catch {
      return [] // missing or corrupt: nothing to act on
    }
  }

  // Launches, teardowns and the sweep all edit the pidfile. One edit runs at a
  // time and each re-reads the file, so none loses another's entries.
  function editPidfile(edit) {
    const run = pidfileQueue.then(async () => {
      await stateDirReady()
      const tmp = `${pidfile}.${process.pid}.tmp`
      await fsx.writeFile(tmp, `${JSON.stringify(edit(await readPidfile()), null, 2)}\n`, { mode: 0o600 })
      await fsx.rename(tmp, pidfile)
    })
    pidfileQueue = run.catch(() => {})
    return run
  }

  const sameEntry = (a, b) => a.pid === b.pid && a.startedAt === b.startedAt
  const without = done => list => list.filter(e => !done.some(d => sameEntry(e, d)))
  const entryOf = proc => ({
    pid: proc.pid, startedAt: proc.startedAt, paneRole: proc.role, kind: proc.kind, name: proc.name, cmd: proc.cmd, args: proc.args,
  })

  async function persist(proc) {
    proc.startedAt = (await Promise.resolve().then(() => psFn(proc.pid)).catch(() => null))?.startedAt ?? null
    if (proc.gone) return // torn down while ps ran: no group left to record
    await editPidfile(list => [...list, entryOf(proc)])
  }

  // --- logs ---

  function pushLine(st, line) {
    st.logs.push(line)
    if (st.logs.length > logLines) st.logs.splice(0, st.logs.length - logLines)
  }

  function resetLogs(st) {
    st.logs = []
    st.stale = false
  }

  // One output stream's lines into the pane's ring buffer, prefixed [name].
  function capture(st, name, stream) {
    if (!stream) return
    const decoder = new StringDecoder('utf8')
    let partial = ''
    const take = text => {
      const lines = (partial + text).split(/\r?\n/)
      partial = lines.pop()
      // a process that never prints a newline mustn't grow this without bound
      if (partial.length > MAX_LINE) {
        lines.push(partial)
        partial = ''
      }
      for (const line of lines) pushLine(st, `[${name}] ${line}`)
    }
    stream.on('data', chunk => take(decoder.write(chunk)))
    stream.on('end', () => {
      take(decoder.end())
      if (partial) pushLine(st, `[${name}] ${partial}`)
      partial = ''
    })
    stream.on('error', () => {}) // a broken pipe must not crash the conductor
  }

  function tail(role, lines = TAIL_LINES) {
    const buf = panes.get(role)?.logs ?? []
    return lines > 0 ? buf.slice(-lines).join('\n') : ''
  }

  const withTail = (err, role) => Object.assign(err, { logTail: tail(role) })

  // --- spawning ---

  // Exactly PATH plus the declared layers: nothing else of baseEnv.
  function childEnv(...layers) {
    const env = {}
    for (const [key, value] of Object.entries(Object.assign({ PATH: baseEnv.PATH }, ...layers))) {
      if (value !== undefined) env[key] = value
    }
    return env
  }

  // Starts one process. It's recorded, and every listener attached, in the
  // same tick as the spawn: a teardown racing this boot always sees it, and
  // no 'error' event goes unheard. Resolves once its pidfile entry is written.
  function start(role, kind, name, spec, env, port) {
    const st = pane(role)
    const { cmd, args = [], cwd } = spec
    if (!exitHooked) {
      exitHooked = true
      onExitFn(killAllNow)
    }
    let child
    try {
      child = spawnFn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      return Promise.reject(startError(name, cmd, cwd, err))
    }
    const proc = { role, kind, name, cmd, args, port, pid: null, startedAt: null, exited: false, exit: null, gone: false }
    // 'error' or 'close' is terminal; 'exit' fires before the output is drained
    proc.done = new Promise(resolve => {
      const finish = exit => {
        if (proc.exited) return
        proc.exited = true
        proc.exit = exit
        resolve(exit)
      }
      child.on('error', error => finish({ error }))
      child.on('close', (code, signal) => finish({ code, signal }))
    })
    st.procs.push(proc)
    if (kind === 'service') byPort.set(port, proc)
    capture(st, name, child.stdout)
    capture(st, name, child.stderr)
    if (!(Number.isSafeInteger(child.pid) && child.pid > 0)) {
      // no pid: the spawn failed, and node says why in 'error'
      return proc.done.then(exit => { throw startError(name, cmd, cwd, exit.error ?? new Error(describeExit(exit))) })
    }
    proc.pid = child.pid
    return persist(proc).then(() => proc)
  }

  async function allocatePort(st) {
    for (let i = 0; i < PORT_ATTEMPTS; i++) {
      const port = await freePortFn(host)
      if (allocated.has(port)) continue
      allocated.add(port)
      st.ports.add(port)
      return port
    }
    throw new Error(`no free port on ${host} after ${PORT_ATTEMPTS} tries`)
  }

  // --- stopping ---

  // 'exit' listeners may only do synchronous work: SIGKILL, with no grace.
  // Signals don't reach here; CLIs call the conductor's shutdown() on those.
  function killAllNow() {
    for (const st of panes.values()) {
      for (const proc of st.procs) {
        if (!killablePid(proc.pid)) continue
        try {
          killFn(-proc.pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
    }
  }

  // Gone once the group can't be signalled: ESRCH means it has no members, and
  // EPERM is what macOS reports for a group left holding only zombies.
  function groupGone(pid) {
    try {
      killFn(-pid, 0)
      return false
    } catch (err) {
      return err?.code === 'ESRCH' || err?.code === 'EPERM'
    }
  }

  async function waitGone(pid, ms) {
    const deadline = nowFn() + ms
    for (;;) {
      if (groupGone(pid)) return true
      if (nowFn() >= deadline) return false
      await sleepFn(PROBE_MS)
    }
  }

  // TERM, then KILL once graceMs passes. True once the group is gone.
  async function stopGroup(pid) {
    try {
      killFn(-pid, 'SIGTERM')
    } catch (err) {
      if (err?.code === 'ESRCH') return true
    }
    if (await waitGone(pid, graceMs)) return true
    try {
      killFn(-pid, 'SIGKILL')
    } catch (err) {
      if (err?.code === 'ESRCH') return true
    }
    return waitGone(pid, KILL_WAIT_MS)
  }

  // True once a pidfile entry needs no more sweeping.
  async function sweepEntry(entry) {
    if (!killablePid(entry.pid) || typeof entry.startedAt !== 'string') return true // nothing we could safely signal
    const cur = await psFn(entry.pid)
    // A reused pid means our group is long gone: a pid isn't reissued while
    // its process group still has members.
    if (cur) return cur.startedAt === entry.startedAt ? stopGroup(entry.pid) : true
    // The leader is gone, but its group may live on; any members are ours.
    const members = await pgroupFn(entry.pid)
    return members?.length ? stopGroup(entry.pid) : true
  }

  const ownedHere = entry =>
    [...panes.values()].some(st => st.procs.some(proc => sameEntry(proc, entry)))

  // --- health ---

  async function waitOne(name, { url, port }, signal, aborted) {
    const proc = byPort.get(port)
    const exited = proc ? proc.done : never
    const path = typeof healthPath === 'function' ? healthPath(name) : healthPath
    const target = `${url ?? `http://${urlHost}:${port}`}${path}`
    const deadline = nowFn() + healthTimeoutMs
    const check = () => {
      if (signal?.aborted) throw abortError()
      if (proc?.exited) throw withTail(new Error(`${name} exited before it was healthy (${describeExit(proc.exit)})`), proc.role)
    }
    for (;;) {
      check()
      // Each attempt gets its own controller, aborted however the race ends,
      // so a hung fetch never outlives its attempt.
      const attempt = new AbortController()
      let status
      try {
        status = await Promise.race([
          (async () => (await fetchFn(target, { signal: attempt.signal }))?.status)().catch(() => undefined),
          sleepFn(Math.max(0, Math.min(ATTEMPT_MAX_MS, deadline - nowFn())), { signal: attempt.signal }).then(() => undefined),
          exited.then(() => undefined),
          aborted,
        ])
      } finally {
        attempt.abort()
      }
      check()
      if (status !== undefined && healthy(status)) return
      if (nowFn() >= deadline) {
        const err = new Error(`${name} on port ${port} not healthy after ${healthTimeoutMs}ms`)
        throw proc ? withTail(err, proc.role) : err
      }
      await Promise.race([sleepFn(RETRY_MS), exited, aborted])
    }
  }

  return {
    async provisionDatabase({ paneRef, signal } = {}) {
      const st = pane(paneRef.role)
      resetLogs(st) // a new boot for this pane
      if (!database) return { dsn: null, db: null }
      await stateDirReady()
      const port = await allocatePort(st)
      if (signal?.aborted) throw abortError()
      const spec = database.command({ paneRef, port })
      const proc = await start(paneRef.role, 'database', 'database', spec, childEnv(spec.env), port)
      const exit = new AbortController()
      proc.done.then(() => exit.abort())
      const readySignal = signal ? AbortSignal.any([signal, exit.signal]) : exit.signal
      try {
        // raced too, so a ready check that ignores its signal can't hang the boot
        await Promise.race([
          (async () => database.ready({ port, signal: readySignal }))(),
          proc.done,
          whenAborted(signal),
        ])
      } catch (err) {
        if (!proc.exited && !signal?.aborted) throw err
      }
      // an abort wins: the teardown that follows one may be what stopped it
      if (signal?.aborted) throw abortError()
      if (proc.exited) {
        throw withTail(new Error(`database exited before it was ready (${describeExit(proc.exit)})`), paneRef.role)
      }
      return database.handle({ paneRef, port })
    },

    async reserveServices({ paneRef, services }) {
      const st = pane(paneRef.role)
      const out = {}
      for (const name of Object.keys(services)) {
        const port = await allocatePort(st)
        out[name] = { url: `http://${urlHost}:${port}`, port }
      }
      return out
    },

    async launchServices({ paneRef, services, env = {}, reserved, signal } = {}) {
      const st = pane(paneRef.role)
      if (st.stale) resetLogs(st) // the first launch since a teardown starts a new buffer
      await stateDirReady()
      for (const name of Object.keys(services)) {
        const port = reserved?.[name]?.port
        if (!port) throw new Error(`${name}: no reserved port (reserveServices first)`)
        if (signal?.aborted) throw abortError()
        const spec = command({ name, ref: services[name], port, env: env?.[name] ?? {}, paneRef })
        await start(paneRef.role, 'service', name, spec, childEnv(env?.[name], spec.env), port)
      }
    },

    async waitHealthy({ services, signal } = {}) {
      const aborted = whenAborted(signal)
      for (const [name, svc] of Object.entries(services ?? {})) {
        if (svc?.port) await waitOne(name, svc, signal, aborted)
      }
    },

    // One buffer per pane, database and services together, each line
    // prefixed [name]; `stage` doesn't narrow it.
    async logs({ paneRef, lines = TAIL_LINES } = {}) {
      return tail(paneRef?.role, lines)
    },

    // Orphans a previous run left behind. Entries of this instance's live
    // processes are left alone; only the entries handled here are removed.
    async sweep() {
      await stateDirReady()
      const done = []
      for (const entry of await readPidfile()) {
        if (ownedHere(entry)) continue
        try {
          if (await sweepEntry(entry)) done.push(entry)
          else log.warn(`[qa] sweep: process group ${entry.pid} (${entry.name}) survived SIGKILL; kept in ${pidfile}`)
        } catch (err) {
          log.warn(`[qa] sweep: skipped pid ${entry.pid}: ${err.message}`)
        }
      }
      if (done.length) await editPidfile(without(done))
    },

    async teardown({ paneRef }) {
      const st = panes.get(paneRef.role)
      if (!st) return
      st.stale = true
      // services before the database they depend on
      const order = [...st.procs.filter(p => p.kind !== 'database'), ...st.procs.filter(p => p.kind === 'database')]
      const gone = []
      for (const proc of order) {
        if (killablePid(proc.pid) && !(await stopGroup(proc.pid))) {
          log.warn(`[qa] ${paneRef.role} ${proc.name}: process group ${proc.pid} survived SIGKILL; kept in ${pidfile} for the next sweep`)
          continue
        }
        proc.gone = true
        gone.push(proc)
      }
      st.procs = st.procs.filter(proc => !proc.gone)
      for (const proc of gone) if (byPort.get(proc.port) === proc) byPort.delete(proc.port)
      const held = new Set(st.procs.map(proc => proc.port))
      for (const port of st.ports) {
        if (held.has(port)) continue
        allocated.delete(port)
        st.ports.delete(port)
      }
      const recorded = gone.filter(proc => proc.pid !== null)
      if (recorded.length) await editPidfile(without(recorded))
    },
  }
}
