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
// in `${stateDir}/pids.json` with the leader's start time (from ps) and the
// boot it ran in, so a later sweep can tell an orphaned group of ours from an
// unrelated process that has reused the pid. A leader that exits while its
// pane is up gives up its pid too, so teardown and the exit hook re-check
// before signalling one.
//
// The env scrubbing and the loopback host are defence in depth only. The
// BuildConvention's trust gate is the one real boundary between a PR's code
// and this machine: these processes run as the conductor's user.
//
// Every effect (spawn, kill, ps, the boot id, fetch, the free-port lookup, fs,
// sleep, the clock and the exit hook) is injected with a real default, so the
// tests start no processes.

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

// The first of `racers(signal)` to settle, or undefined once any of `signals`
// aborts. `signal` aborts as the race ends and the listeners come off
// `signals` with it, so a long-lived signal gains nothing per race and no
// racer that honours its signal outlives the race.
async function race(signals, racers) {
  const live = signals.filter(Boolean)
  if (live.some(s => s.aborted)) return undefined
  const ctl = new AbortController()
  const stop = () => ctl.abort()
  const stopped = new Promise(resolve => ctl.signal.addEventListener('abort', () => resolve(undefined), { once: true }))
  for (const s of live) s.addEventListener('abort', stop, { once: true })
  try {
    return await Promise.race([...racers(ctl.signal), stopped])
  } finally {
    ctl.abort()
    for (const s of live) s.removeEventListener('abort', stop)
  }
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

// A fixed locale and zone: start times are compared as text, so one recorded
// before the machine's zone changed must still match after.
function execText(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { PATH: process.env.PATH, LC_ALL: 'C', TZ: 'UTC' } }, (err, stdout) => {
      if (err) reject(err)
      else resolve(String(stdout))
    })
  })
}

// The leader's start time, to the second: fixed for the life of a process, and
// different for any later process that reuses its pid.
async function defaultPs(pid) {
  try {
    const startedAt = (await execText('ps', ['-o', 'lstart=', '-p', String(pid)])).trim()
    return startedAt ? { startedAt } : null
  } catch (err) {
    if (err.code === 1) return null // ps exits 1 when there is no such process
    throw err
  }
}

async function defaultPgroup(pgid) {
  const members = []
  for (const line of (await execText('ps', ['-A', '-o', 'pid=,pgid='])).split('\n')) {
    const [pid, group] = line.trim().split(/\s+/).map(Number)
    if (group === pgid && Number.isSafeInteger(pid)) members.push(pid)
  }
  return members
}

// Different on every boot, and nothing survives one. macOS has a uuid per
// boot; other BSDs only the boot time.
async function defaultBootId() {
  if (process.platform === 'linux') return (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
  return (await execText('sysctl', ['-n', process.platform === 'darwin' ? 'kern.bootsessionuuid' : 'kern.boottime'])).trim()
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
  unlink: fs.unlink,
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
  bootIdFn = defaultBootId,
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
  let bootIdReady = null
  let pidfileQueue = Promise.resolve()

  function pane(role) {
    let st = panes.get(role)
    if (!st) panes.set(role, (st = { procs: [], logs: [], ports: new Set(), stale: false }))
    return st
  }

  // null when it can't be read; the sweep then can't rule out a reboot
  function bootId() {
    bootIdReady ??= Promise.resolve()
      .then(() => bootIdFn())
      .then(id => (typeof id === 'string' && id ? id : null), () => null)
      .then(id => {
        if (!id) log.warn('[qa] no boot id: the sweep cannot tell entries from an earlier boot')
        return id
      })
    return bootIdReady
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
    // Whatever another user could have put in it can't be trusted, so no chmod fixes this.
    if (st.mode & 0o022) {
      throw new Error(`stateDir ${stateDir} is writable by group or others (mode ${(st.mode & 0o777).toString(8)}): check its contents, then chmod it 0700`)
    }
    if (st.mode & 0o077) await fsx.chmod(stateDir, 0o700)
  }

  async function readPidfile() {
    let st
    try {
      st = await fsx.lstat(pidfile)
    } catch {
      return [] // missing: nothing to act on
    }
    const uid = process.getuid?.()
    if (!st.isFile() || (uid !== undefined && st.uid !== uid)) {
      log.warn(`[qa] ${pidfile} is not a regular file owned by uid ${uid}; ignored`)
      return []
    }
    try {
      const list = JSON.parse(String(await fsx.readFile(pidfile, 'utf8')))
      return Array.isArray(list) ? list.filter(e => e && typeof e === 'object') : []
    } catch {
      return [] // corrupt: nothing to act on
    }
  }

  // Launches, teardowns and the sweep all edit the pidfile. One edit runs at a
  // time and each re-reads the file, so none loses another's entries.
  function editPidfile(edit) {
    const run = pidfileQueue.then(async () => {
      await stateDirReady()
      const tmp = `${pidfile}.${process.pid}.tmp`
      const data = `${JSON.stringify(edit(await readPidfile()), null, 2)}\n`
      // created afresh, so a file or symlink left at the tmp path is replaced, never written through
      await fsx.unlink(tmp).catch(err => {
        if (err?.code !== 'ENOENT') throw err
      })
      await fsx.writeFile(tmp, data, { mode: 0o600, flag: 'wx' })
      await fsx.rename(tmp, pidfile)
    })
    pidfileQueue = run.catch(() => {})
    return run
  }

  const sameEntry = (a, b) => a.pid === b.pid && a.startedAt === b.startedAt
  const without = done => list => list.filter(e => !done.some(d => sameEntry(e, d)))
  const entryOf = (proc, boot) => ({
    pid: proc.pid, startedAt: proc.startedAt, bootId: boot, paneRole: proc.role, kind: proc.kind, name: proc.name, cmd: proc.cmd, args: proc.args,
  })

  async function persist(proc) {
    const [cur, boot] = await Promise.all([Promise.resolve().then(() => psFn(proc.pid)).catch(() => null), bootId()])
    proc.startedAt = cur?.startedAt ?? null
    if (proc.gone) return // torn down while ps ran: no group left to record
    if (proc.startedAt === null) {
      log.warn(`[qa] ${proc.role} ${proc.name}: could not read the start time of pid ${proc.pid}; a later sweep will leave its group alone`)
    }
    await editPidfile(list => [...list, entryOf(proc, boot)])
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
    const exitCtl = new AbortController()
    const proc = {
      role, kind, name, cmd, args, port, pid: null, startedAt: null,
      exited: false, exit: null, exitSignal: exitCtl.signal, reaped: false, groupEnded: false, gone: false,
    }
    // Node reaps the leader just before 'exit'. From then on its pid can be
    // reissued once the group is empty, so note now whether it already is.
    const reaped = () => {
      if (proc.reaped) return
      proc.reaped = true
      if (killablePid(proc.pid) && groupGone(proc.pid)) proc.groupEnded = true
    }
    // 'error' or 'close' is terminal; 'exit' fires before the output is drained
    proc.done = new Promise(resolve => {
      const finish = exit => {
        if (proc.exited) return
        proc.exited = true
        proc.exit = exit
        exitCtl.abort()
        resolve(exit)
      }
      child.on('error', error => finish({ error }))
      child.on('exit', reaped)
      child.on('close', (code, signal) => {
        reaped() // 'close' always follows 'exit'
        finish({ code, signal })
      })
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
        // A group that was empty when its leader was reaped may have lost its
        // pid to someone else, and there's no time here for ps: its entry
        // stays in the pidfile for the next sweep. A reaped leader whose group
        // still had members (a wrapper's orphans) is still killed.
        if (!killablePid(proc.pid) || proc.groupEnded) continue
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

  async function waitGone(pid, ms, proc) {
    const deadline = nowFn() + ms
    for (;;) {
      // once our group is known to have ended, its pid may already be someone else's
      if (proc?.groupEnded || groupGone(pid)) return true
      if (nowFn() >= deadline) return false
      await sleepFn(PROBE_MS)
    }
  }

  // TERM, then KILL once graceMs passes. True once the group is gone.
  async function stopGroup(pid, proc) {
    try {
      killFn(-pid, 'SIGTERM')
    } catch (err) {
      if (err?.code === 'ESRCH') return true
    }
    if (await waitGone(pid, graceMs, proc)) return true
    try {
      killFn(-pid, 'SIGKILL')
    } catch (err) {
      if (err?.code === 'ESRCH') return true
    }
    return waitGone(pid, KILL_WAIT_MS, proc)
  }

  // True when our group is known to be gone without signalling it; undefined
  // when that can't be checked. Once the leader is reaped, any process holding
  // its pid is someone else's, and a pid isn't reissued while its group has
  // members: our group is gone. With no holder, the group may still hold a
  // wrapper's orphans, and any members are ours.
  async function ended(proc) {
    if (proc.groupEnded) return true
    if (!proc.reaped) return false
    let cur
    try {
      cur = await psFn(proc.pid)
    } catch {
      return undefined
    }
    return cur != null
  }

  // True once a pidfile entry needs no more sweeping; the entry has a valid
  // pid and a start time.
  async function sweepEntry(entry) {
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

  async function waitOne(name, { url, port }, signal) {
    const proc = byPort.get(port)
    const stops = [signal, proc?.exitSignal]
    const path = typeof healthPath === 'function' ? healthPath(name) : healthPath
    const target = `${url ?? `http://${urlHost}:${port}`}${path}`
    const deadline = nowFn() + healthTimeoutMs
    const check = () => {
      if (signal?.aborted) throw abortError()
      if (proc?.exited) throw withTail(new Error(`${name} exited before it was healthy (${describeExit(proc.exit)})`), proc.role)
    }
    for (;;) {
      check()
      // The fetch's signal aborts however the attempt ends, so a hung fetch
      // never outlives it. Redirects aren't followed: an app often redirects
      // to its public origin, the pane proxy, which answers 503 until the
      // boot is done, so following one would judge the proxy, not the service.
      const status = await race(stops, attempt => [
        (async () => (await fetchFn(target, { signal: attempt, redirect: 'manual' }))?.status)().catch(() => undefined),
        sleepFn(Math.max(0, Math.min(ATTEMPT_MAX_MS, deadline - nowFn())), { signal: attempt }).then(() => undefined),
      ])
      check()
      if (status !== undefined && healthy(status)) return
      if (nowFn() >= deadline) {
        const err = new Error(`${name} on port ${port} not healthy after ${healthTimeoutMs}ms`)
        throw proc ? withTail(err, proc.role) : err
      }
      await race(stops, pause => [sleepFn(RETRY_MS, { signal: pause })])
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
      const readySignal = signal ? AbortSignal.any([signal, proc.exitSignal]) : proc.exitSignal
      try {
        // raced too, so a ready check that ignores its signal can't hang the boot
        await race([signal, proc.exitSignal], () => [(async () => database.ready({ port, signal: readySignal }))()])
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
      for (const [name, svc] of Object.entries(services ?? {})) {
        if (svc?.port) await waitOne(name, svc, signal)
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
      const boot = await bootId()
      const done = []
      for (const entry of await readPidfile()) {
        if (ownedHere(entry)) continue
        // Nothing outlives a reboot, so an entry from an earlier one names only
        // dead processes, whatever holds its pid (or pgid) now.
        if (boot && entry.bootId !== boot) {
          done.push(entry)
          continue
        }
        // Nothing to check it against: kept, until a reboot clears it.
        if (!killablePid(entry.pid) || typeof entry.startedAt !== 'string') continue
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
        if (killablePid(proc.pid)) {
          const known = await ended(proc)
          if (known === undefined) {
            log.warn(`[qa] ${paneRef.role} ${proc.name}: could not check whether pid ${proc.pid} is still ours; not signalled, kept in ${pidfile}`)
            continue
          }
          if (!known && !(await stopGroup(proc.pid, proc))) {
            log.warn(`[qa] ${paneRef.role} ${proc.name}: process group ${proc.pid} survived SIGKILL; kept in ${pidfile} for the next sweep`)
            continue
          }
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
