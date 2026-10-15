// The per-session isolation verdict: whether the PR pane can reach the base
// pane, so a base-vs-PR comparison (#8) knows whether the base pane shows only
// what the base did. Pure: the conductor (lib/server.mjs) gathers the parts.
//
// A verdict is one of VERDICTS, best to worst:
// - isolated: the Provisioner's check found no way from the PR pane to the
//   base pane, and nothing about the runtime says otherwise;
// - unknown: nothing could tell, or a check failed;
// - reachable: the PR pane can reach the base pane's containers or ports;
// - shared-host: both panes run as one user on one host (the process
//   Provisioner): there is nothing to check.
// Only `isolated` lets the base pane's changes excuse a PR change.

import { isIPv4 } from 'node:net'

import { isLoopbackHost } from './net.mjs'

export const VERDICTS = ['isolated', 'unknown', 'reachable', 'shared-host']

// What the runtime says before any check: never better than these, whatever
// a check finds. `host` is the address the conductor listens on (default
// 127.0.0.1), `platform` process.platform's value.
export function floors({ host = '127.0.0.1', platform }) {
  const out = []
  if (platform === 'darwin') {
    out.push({
      verdict: 'reachable',
      reason: 'on macOS, containers run in a VM that forwards the host\'s loopback (Docker Desktop, Podman machine), where the base app is published',
    })
  }
  if (!isLoopbackHost(host)) {
    out.push({ verdict: 'reachable', reason: `the conductor listens on ${host}, which containers can reach` })
  } else if (!(isIPv4(host) && host.startsWith('127.'))) {
    // A probe reaches the conductor to show it reaches the host's loopback;
    // the Docker Provisioner publishes the pane apps on 127.0.0.1.
    out.push({
      verdict: 'unknown',
      reason: `the conductor listens on ${host}, not on 127.0.0.1 where the pane apps are published, so a probe of it can't speak for their ports`,
    })
  }
  return out
}

// A Provisioner's `isolation` member, before anything runs: 'shared-host'
// declares the verdict, a function is a check still to run (null), and
// anything else, none included, leaves it unknown.
export function declared(provisioner) {
  const isolation = provisioner?.isolation
  if (typeof isolation === 'function') return null
  if (isolation === 'shared-host') return { verdict: 'shared-host', reasons: ['both panes run as one user on this host'] }
  if (isolation === undefined || isolation === null) return { verdict: 'unknown', reasons: ['the Provisioner has no isolation check'] }
  return { verdict: 'unknown', reasons: [`the Provisioner declares isolation ${JSON.stringify(isolation)}, which only a check can show`] }
}

// A check's result as { verdict, reasons }: isolated, reachable or unknown,
// with its string reasons. Anything else is unknown, and a verdict other than
// isolated with no reason gets one.
export function fromCheck(result) {
  const verdict = result?.verdict
  if (!['isolated', 'reachable', 'unknown'].includes(verdict)) return { verdict: 'unknown', reasons: ['the isolation check gave no verdict'] }
  const reasons = Array.isArray(result.reasons) ? result.reasons.filter(reason => typeof reason === 'string') : []
  if (verdict !== 'isolated' && reasons.length === 0) return { verdict, reasons: ['the isolation check gave no reason'] }
  return { verdict, reasons: verdict === 'isolated' ? [] : reasons }
}

// The worst of these parts, each { verdict, reasons } or a floor's
// { verdict, reason }, with every reason given against isolation.
export function combine(parts) {
  let rank = 0
  const reasons = []
  for (const part of parts) {
    rank = Math.max(rank, VERDICTS.indexOf(part.verdict))
    if (part.verdict !== 'isolated') reasons.push(...(part.reasons ?? [part.reason]))
  }
  return { verdict: VERDICTS[rank], reasons }
}
