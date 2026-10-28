p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/adapters/provisioner-docker.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b, 1)


sub("""// Single-service per pane: each pane runs its services as `qa-app-<role>`
// with one env file; multi-service docker panes are a follow-up when a
// consumer needs them.
""", """// Single-service per pane: each pane runs its services as `qa-app-<role>`
// with one env file; multi-service docker panes are a follow-up when a
// consumer needs them.
//
// With `internal` (#32), the PR pane's network is internal: no route off
// itself, to the host or to the base pane. A forwarder (lib/forwarder.mjs)
// on an ordinary network, joined to the internal one as `qa-egress`,
// publishes the PR app on the host's loopback and is its only way out: an
// HTTP proxy that lets it out only to the hosts on the allowlist. If any of
// that can't be set up, the PR pane runs as it would without `internal`.
""")

sub("""import { randomBytes } from 'node:crypto'
import { errorLine } from '../docker.mjs'
import { renderEnv } from '../session.mjs'
""", """import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { errorLine } from '../docker.mjs'
import { parseAllowlist } from '../forwarder.mjs'
import { renderEnv } from '../session.mjs'
""")

sub("""const aborted = () => Object.assign(new Error('boot aborted'), { name: 'AbortError' })
""", """const aborted = () => Object.assign(new Error('boot aborted'), { name: 'AbortError' })

// --- #32: the PR pane on an internal network -------------------------------------

const FORWARDER_IMAGE = 'node:22-alpine'
// The forwarder's name on the internal network, and its proxy's port.
const EGRESS = { alias: 'qa-egress', port: 3128 }
const FORWARDER = 'qa-fwd-pr'

// `internal`: off (undefined, null, false), true (no egress at all), or
// { egress: the allowlist, image: the forwarder's }. The allowlist is
// checked now, so a typo never opens more than meant.
function internalOption(internal) {
  if (internal === undefined || internal === null || internal === false) return null
  const given = internal === true ? {} : internal
  if (typeof given !== 'object' || Array.isArray(given)) throw new Error('internal must be true, or { egress, image }')
  for (const key of Object.keys(given)) {
    if (key !== 'egress' && key !== 'image') throw new Error(`internal has no option ${JSON.stringify(key)}: egress or image`)
  }
  try {
    parseAllowlist(given.egress)
  } catch (err) {
    throw new Error(`internal: ${err.message}`)
  }
  const image = given.image ?? FORWARDER_IMAGE
  if (typeof image !== 'string' || image === '' || /\\s/.test(image)) throw new Error(`internal.image must be an image name: ${JSON.stringify(image)}`)
  return Object.freeze({ egress: Object.freeze([...(given.egress ?? [])]), image })
}
""")

sub("""// The isolation probe, run with bash in the postgres image on the PR pane's
// network: `probe <port> <path> <expect> <host>… -- <address:port>… --
// <own address:port>…`.""", """// The isolation probe, run with bash in the postgres image on the PR pane's
// network: `probe <port> <path> <expect> <host>… -- <address:port>… --
// <own address:port>… [-- <proxy host:port> <target>…]`.""")
sub("""// - For each own address (the PR pane's database), the same: `self
//   <address:port>`, its positive control. A probe that reaches nothing,
//   not even that, has shown nothing.
// All at once, each in at most 3 seconds, then `probe done`.""", """// - For each own address (the PR pane's database), the same: `self
//   <address:port>`, its positive control. A probe that reaches nothing,
//   not even that, has shown nothing.
// - With a proxy (the forwarder's, on an internal network), a CONNECT
//   through it to each target: `proxied <target>` when it answers 200,
//   `refused <target>` when it answers otherwise, and nothing when it doesn't
//   answer at all.
// All at once, each in at most 3 seconds, then `probe done`.""")
sub("""  'hosts=() targets=() selves=() part=0',
  'for a in "$@"; do',
  '  if [ "$a" = -- ]; then part=$((part + 1))',
  '  elif [ "$part" = 0 ]; then hosts+=("$a")',
  '  elif [ "$part" = 1 ]; then targets+=("$a")',
  '  else selves+=("$a")',
  '  fi',
  'done',""", """  'hosts=() targets=() selves=() vias=() part=0',
  'for a in "$@"; do',
  '  if [ "$a" = -- ]; then part=$((part + 1))',
  '  elif [ "$part" = 0 ]; then hosts+=("$a")',
  '  elif [ "$part" = 1 ]; then targets+=("$a")',
  '  elif [ "$part" = 2 ]; then selves+=("$a")',
  '  else vias+=("$a")',
  '  fi',
  'done',""")
sub("""  'for h in "${hosts[@]}"; do listener "$h" & done',""", """  'proxy=${vias[0]:-}',
  'via() {',
  '  local line',
  '  line=$(timeout 3 bash -c \\'exec 3<>"/dev/tcp/$1/$2" || exit 1; printf "CONNECT %s HTTP/1.1\\\\r\\\\nHost: %s\\\\r\\\\n\\\\r\\\\n" "$3" "$3" >&3; IFS= read -r line <&3; printf "%s\\\\n" "$line"\\' _ "${proxy%:*}" "${proxy##*:}" "$1" 2>/dev/null)',
  '  case "$line" in',
  '    "HTTP/1."?" 200"*) echo "proxied $1" ;;',
  '    HTTP/*) echo "refused $1" ;;',
  '  esac',
  '}',
  'for h in "${hosts[@]}"; do listener "$h" & done',""")
sub("""  'for t in "${selves[@]}"; do connects "$t" self & done',""", """  'for t in "${selves[@]}"; do connects "$t" self & done',
  'for t in "${vias[@]:1}"; do via "$t" & done',""")

sub("""  // how long the isolation probe's docker run may take, in all
  probeTimeoutMs = 30_000,
}) {
  const networks = paneNetworks(network)""", """  // how long the isolation probe's docker run may take, in all
  probeTimeoutMs = 30_000,
  // the PR pane on an internal network (#32): true, or { egress, image }
  internal = null,
}) {
  const networks = paneNetworks(network)
  const inside = internalOption(internal)
  // the forwarder's ordinary network, beside the PR pane's internal one
  const edge = `${networks.pr}-edge`
  if (inside && edge === networks.base) throw new Error(`the PR pane's edge network, ${edge}, is the base pane's`)""")

sub("""  // the isolation probe, on the PR pane's network
  const probeName = 'qa-probe-pr'""", """  // the isolation probe, on the PR pane's network
  const probeName = 'qa-probe-pr'
  // This boot's internal topology, once provisionDatabase set it up or fell
  // back: { up: true } or { up: false, failure }.
  let topology = null
  const internalUp = () => inside !== null && topology?.up === true
  let forwarderSource = null
  // The PR pane's proxy settings, which win over the EnvTransform's there.
  const proxyEnv = () => {
    const url = `http://${EGRESS.alias}:${EGRESS.port}`
    const none = ['localhost', '127.0.0.1', '::1', pgName('pr'), appName('pr')].join(',')
    return { HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url, NO_PROXY: none, no_proxy: none, NODE_USE_ENV_PROXY: '1' }
  }
  const paneEnv = (role, env) => (role === 'pr' && internalUp() ? { ...(env ?? {}), ...proxyEnv() } : env)""")

sub("""  const live = signal => {
    if (signal?.aborted) throw aborted()
  }
""", """  const live = signal => {
    if (signal?.aborted) throw aborted()
  }

  // The PR pane's internal network, the forwarder's ordinary one, and the
  // forwarder on it, then joined to the internal one as qa-egress. Any step
  // that fails undoes them all, and the pane gets an ordinary network, as
  // without `internal`. An internal network left over is reused only when it
  // is internal.
  const internalNetwork = async signal => {
    const net = networks.pr
    try {
      live(signal)
      await docker.createNetwork(edge).catch(err => reuseNetwork(edge, err))
      live(signal)
      await docker.createNetwork(net, { internal: true }).catch(async err => {
        await reuseNetwork(net, err)
        if (!(await docker.networkInternal(net))) throw new Error(`a network ${net} exists that isn't internal`)
      })
      live(signal)
      await docker.ensureImage(inside.image, ensureOpts)
      forwarderSource ??= await readFile(new URL('../forwarder.mjs', import.meta.url), 'utf8')
      const config = {
        host: '0.0.0.0',
        forward: { listen: 3000, to: `${appName('pr')}:3000` },
        proxy: { listen: EGRESS.port, allow: inside.egress },
      }
      live(signal)
      await docker.runForwarder(FORWARDER, inside.image, edge, { hostPort: hostPorts.pr, config, source: forwarderSource })
      live(signal)
      await docker.connectNetwork(net, FORWARDER, { alias: EGRESS.alias })
      return { up: true }
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      await docker.rmForce([FORWARDER]).catch(() => {})
      await docker.rmNetwork(net).catch(() => {})
      await docker.rmNetwork(edge).catch(() => {})
      live(signal)
      await docker.createNetwork(net).catch(e => reuseNetwork(net, e))
      return { up: false, failure: errorLine(err) }
    }
  }
""")

sub("""    networks,

    async provisionDatabase({ paneRef, databases, signal }) {
      const net = networkOf(paneRef.role)
      live(signal)
      // One left over is reused; any other failure, such as no address pool
      // left, stops the boot here.
      await docker.createNetwork(net).catch(err => reuseNetwork(net, err))""", """    networks,
    // the PR pane is meant for an internal network: until the check's result
    // says `internal: true`, nothing is taken for it (lib/isolation.mjs)
    internal: inside !== null,

    async provisionDatabase({ paneRef, databases, signal }) {
      const net = networkOf(paneRef.role)
      live(signal)
      if (paneRef.role === 'pr' && inside) {
        topology = null
        topology = await internalNetwork(signal)
      } else {
        // One left over is reused; any other failure, such as no address
        // pool left, stops the boot here.
        await docker.createNetwork(net).catch(err => reuseNetwork(net, err))
      }""")

sub("""      const file = await writeEnv(paneRef.role, env.app ?? Object.values(env)[0])
      live(signal)
      await docker.runMigrate(""", """      const file = await writeEnv(paneRef.role, paneEnv(paneRef.role, env.app ?? Object.values(env)[0]))
      live(signal)
      await docker.runMigrate(""")
sub("""        const file = await writeEnv(paneRef.role, env[name])
        live(signal)
        await docker.runApp(appName(paneRef.role), image, net, file, reserved[name].port)""", """        const file = await writeEnv(paneRef.role, paneEnv(paneRef.role, env[name]))
        live(signal)
        // on an internal network, the forwarder publishes the app's port
        await docker.runApp(appName(paneRef.role), image, net, file, paneRef.role === 'pr' && internalUp() ? null : reserved[name].port)""")

sub("""        for (const name of [networks.base, networks.pr]) failures.push(await docker.rmNetwork(name).then(() => {}, err => err))""",
    """        for (const name of [networks.base, networks.pr, ...(inside ? [edge] : [])]) failures.push(await docker.rmNetwork(name).then(() => {}, err => err))""")

open(p, 'w').write(s)
print('ok')
