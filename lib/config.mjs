// Generic conductor configuration: parse `.env.qa` (plain KEY=value lines)
// into the settings the CORE needs. There are no app defaults here: a
// consuming platform passes its own `defaults` (and any keys it must insist
// on as `required`) and reads its app-specific keys (image repo, database
// identity, ...) from the returned raw `env` map. See the homefree platform's
// config-homefree.mjs for the reference reader.

import { readFileSync } from 'node:fs'

import { hostPort, isLoopbackHost, webOrigin } from './net.mjs'

// Where the harness is served under its origin. Fixed: public/index.html and
// public/harness.js load and call /qa/... .
export const HARNESS_PATH = '/qa'

// The harness origin when none is configured: :8444 on the public host, else
// the loopback address the harness listens on, else null (on port 0 the
// conductor derives it from the bound port; off loopback it can't be known).
export function defaultHarnessOrigin({ publicHost, host, port }) {
  if (publicHost) return webOrigin(`https://${publicHost}:8444`, 'the harness origin derived from QA_PUBLIC_HOST')
  if (isLoopbackHost(host) && port > 0) return new URL(`http://${hostPort(host, port)}`).origin
  return null
}

export function parseEnvFile(envFilePath) {
  const env = {}
  for (const line of readFileSync(envFilePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

const num = (value, fallback) => (value ? Number(value) : fallback)

const list = value => String(value ?? '').split(',').map(s => s.trim()).filter(Boolean)

// The harness and the panes each act for the operator, so none may be
// same-origin with another: a pane's page (PR code) would then drive the
// harness API or the other pane. Throws naming the first pair that collides.
function checkDistinct(origins, envFilePath) {
  const seen = new Map()
  for (const [name, origin] of Object.entries(origins)) {
    if (origin === null) continue
    if (seen.has(origin)) {
      throw new Error(
        `the harness and the two panes must be three different origins, but the ${seen.get(origin)} and ${name} are both ${origin} ` +
          `in ${envFilePath} (QA_HARNESS_ORIGIN, QA_BASE_ORIGIN, QA_PR_ORIGIN)`,
      )
    }
    seen.set(origin, name)
  }
}

// Keys the core cannot run without. QA_PUBLIC_HOST joins them only when it is
// needed to derive a pane origin that wasn't given explicitly.
function requiredKeys(env, extra) {
  const keys = new Set(['GITHUB_QA_TOKEN', 'QA_REPO', ...extra])
  if (!(env.QA_BASE_ORIGIN && env.QA_PR_ORIGIN)) keys.add('QA_PUBLIC_HOST')
  return keys
}

export function loadConfig(envFilePath, { defaults = {}, required = [] } = {}) {
  const env = { ...defaults, ...parseEnvFile(envFilePath) }
  for (const key of requiredKeys(env, required)) {
    if (!env[key]) throw new Error(`${key} missing in ${envFilePath}`)
  }
  const publicHost = env.QA_PUBLIC_HOST || null
  const host = env.QA_BIND_HOST || '127.0.0.1'
  const ports = {
    harness: num(env.QA_HARNESS_PORT, 3100),
    base: num(env.QA_BASE_PROXY_PORT, 3101),
    pr: num(env.QA_PR_PROXY_PORT, 3102),
  }
  const paneOrigins = {
    base: env.QA_BASE_ORIGIN
      ? webOrigin(env.QA_BASE_ORIGIN, 'QA_BASE_ORIGIN')
      : webOrigin(`https://${publicHost}:8443`, 'QA_BASE_ORIGIN (derived from QA_PUBLIC_HOST)'),
    pr: env.QA_PR_ORIGIN
      ? webOrigin(env.QA_PR_ORIGIN, 'QA_PR_ORIGIN')
      : webOrigin(`https://${publicHost}:10000`, 'QA_PR_ORIGIN (derived from QA_PUBLIC_HOST)'),
  }
  const harnessOrigin = env.QA_HARNESS_ORIGIN
    ? webOrigin(env.QA_HARNESS_ORIGIN, 'QA_HARNESS_ORIGIN')
    : defaultHarnessOrigin({ publicHost, host, port: ports.harness })
  if (harnessOrigin === null && !(isLoopbackHost(host) && ports.harness === 0)) {
    throw new Error(
      `QA_HARNESS_ORIGIN missing in ${envFilePath}: with QA_BIND_HOST=${host} and no QA_PUBLIC_HOST, ` +
        'the origin viewers open the harness at cannot be derived (for example https://qa.example.com:8444)',
    )
  }
  checkDistinct({ harness: harnessOrigin, base: paneOrigins.base, pr: paneOrigins.pr }, envFilePath)

  return {
    env,
    githubToken: env.GITHUB_QA_TOKEN,
    operatorEmail: env.QA_OPERATOR_EMAIL || null,
    repo: env.QA_REPO,
    publicHost,
    idleMinutes: num(env.QA_IDLE_MINUTES, 30),
    // The address all three servers listen on. Loopback by default: the API
    // is unauthenticated and a pane proxy is a signed-in pane session.
    host,
    // Extra Host-header hostnames the servers answer to, beyond loopback, the
    // public host and the pane origins (DNS-rebinding defence).
    allowedHosts: list(env.QA_ALLOWED_HOSTS),
    // Listen ports: the harness UI/API and the two pane proxies.
    ports,
    // The external origin a viewer reaches each pane at: the TLS terminator in
    // front of the pane proxies. Defaults match a tailscale-serve layout.
    paneOrigins,
    // The origin viewers open the harness at (its page is HARNESS_PATH/ under
    // it). Only it, the panes themselves and frameAncestors may frame a pane,
    // a navigation into a pane from another site must come from it, and the
    // mirror bridge talks only to it. null: derived from the bound port.
    harnessOrigin,
    // Extra origins allowed to frame the panes, for a harness that is itself
    // framed (self-QA's inner demos). CSP only: no Referer or bridge trust.
    frameAncestors: list(env.QA_FRAME_ANCESTORS).map(v => webOrigin(v, 'QA_FRAME_ANCESTORS')),
    verdictLabels: {
      accept: env.QA_LABEL_ACCEPT || 'qa-approved',
      reject: env.QA_LABEL_REJECT || 'qa-changes-requested',
    },
  }
}
