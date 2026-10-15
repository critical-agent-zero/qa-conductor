// The per-browser capability: what lets a request through the conductor's
// three listeners once the identity gate and the request guards have passed
// it. Those keep out other devices and other pages; this keeps out PR code
// that can reach loopback on this host (a process pane, or a container pane
// on a runtime that forwards to the host's loopback), which can send any
// header a browser would.
//
// A browser enrols once and holds two secrets:
// - a harness token, which the harness page keeps in localStorage at the
//   harness origin and sends as X-QA-Cap (the event stream as ?cap=). The
//   browser never attaches it on its own, so it never rides to another port.
// - a pane token, in an HttpOnly, SameSite=Strict cookie set by each pane's
//   /__qa/enter from a one-time ticket the harness asks for. Frames and
//   subresources can't send a header, so the panes need a cookie. It lasts
//   one session: rotatePanes replaces every browser's.
//
// The store keeps both in memory, so a restart revokes every one. When a
// browser may enrol (the enrolment window) is the conductor's to decide:
// lib/server.mjs. Pure apart from the random source: no I/O.

import { createHash, randomBytes } from 'node:crypto'

// The request header the harness page sends its token in.
export const CAP_HEADER = 'x-qa-cap'
// X-QA-Refusal's value on a 403 for want of the capability.
export const REFUSAL_CAPABILITY = 'capability'
// Where a pane redeems a one-time ticket for its cookie.
export const ENTER_ROUTE = '/__qa/enter'
// Browsers enrolled at once; enrolling one more drops the least recently used.
export const MAX_BROWSERS = 32
// How long a pane-entry ticket and an invite link last.
export const ENTER_TTL_MS = 60_000
export const INVITE_TTL_MS = 10 * 60_000

const MAX_TICKETS = 64
// What a token or ticket looks like: base64url, as random() makes them. A
// value of any other shape is refused before it is hashed.
const KEY = /^[A-Za-z0-9_-]{16,128}$/

const sha256 = value => createHash('sha256').update(value).digest('hex')
const keyOf = value => (typeof value === 'string' && KEY.test(value) ? sha256(value) : null)

// The pane cookie's name: qa-<8 hex digits of the harness origin's hash>, so
// a conductor nested in another one's pane (self-QA) keeps a cookie of its
// own, and __Host- before it when the pane is served over https (the prefix
// needs Secure, which a browser refuses over plain http).
export function paneCookieName(harnessOrigin, paneOrigin) {
  const id = sha256(String(harnessOrigin ?? '')).slice(0, 8)
  return `${/^https:/i.test(String(paneOrigin ?? '')) ? '__Host-' : ''}qa-${id}`
}

// The Set-Cookie that carries it. No Max-Age: the harness sets it again on
// every pane load.
export function paneCookie(name, value, secure) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

// Every value a Cookie header gives the cookie `name`, in order. A browser
// sends one per path a cookie of that name was set for, so a page can add
// its own beside the real one; any of them may be the right one.
export function cookieValues(header, name) {
  const values = []
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === name) values.push(part.slice(eq + 1).trim())
  }
  return values
}

export function createCapability({
  now = Date.now, random = () => randomBytes(32).toString('base64url'), maxBrowsers = MAX_BROWSERS, maxTickets = MAX_TICKETS,
} = {}) {
  const browsers = new Map() // hash of the harness token -> record
  const panes = new Map() // hash of the pane token -> record
  const tickets = new Map() // hash of the ticket -> { kind, role, to, record, expiresAt }

  // A record: { paneToken, paneKey, lastUsed }. The pane token is kept to set
  // the cookie again; the harness token only as its hash.
  function enrol() {
    const token = random()
    const paneToken = random()
    const record = { paneToken, paneKey: sha256(paneToken), lastUsed: now() }
    browsers.set(sha256(token), record)
    panes.set(record.paneKey, record)
    while (browsers.size > maxBrowsers) drop(oldest())
    return token
  }

  function oldest() {
    let found = null
    for (const [key, record] of browsers) if (found === null || record.lastUsed < found[1].lastUsed) found = [key, record]
    return found
  }

  function drop([key, record]) {
    browsers.delete(key)
    panes.delete(record.paneKey)
  }

  // A new pane token for every browser; the old ones admit nothing. The
  // conductor calls this whenever a session's panes come down or go up, so
  // a pane cookie an app may have seen dies with its session.
  function rotatePanes() {
    panes.clear()
    for (const record of browsers.values()) {
      record.paneToken = random()
      record.paneKey = sha256(record.paneToken)
      panes.set(record.paneKey, record)
    }
  }

  // The record a harness token belongs to, or null; using it counts as use.
  function browser(token) {
    const record = browsers.get(keyOf(token)) ?? null
    if (record) record.lastUsed = now()
    return record
  }

  function mint(kind, fields, ttl) {
    const t = now()
    for (const [key, ticket] of tickets) if (ticket.expiresAt <= t) tickets.delete(key)
    while (tickets.size >= maxTickets) tickets.delete(tickets.keys().next().value)
    const ticket = random()
    const expiresAt = t + ttl
    tickets.set(sha256(ticket), { kind, ...fields, expiresAt })
    return { ticket, expiresAt }
  }

  // The ticket of this kind, spent: a ticket counts once, whatever the
  // outcome. null when it is unknown, of another kind, expired, or its
  // browser has been dropped since.
  function spend(value, kind) {
    const key = keyOf(value)
    const ticket = key === null ? undefined : tickets.get(key)
    if (ticket === undefined) return null
    tickets.delete(key)
    if (ticket.kind !== kind || ticket.expiresAt <= now()) return null
    if (ticket.record && panes.get(ticket.record.paneKey) !== ticket.record) return null
    return ticket
  }

  return {
    enrol,
    browser,
    rotatePanes,
    // Whether a pane cookie's value is an enrolled browser's.
    admitsPane: value => panes.has(keyOf(value)),
    // The pane token of the browser that holds this harness token, or null.
    paneToken: token => browsers.get(keyOf(token))?.paneToken ?? null,
    size: () => browsers.size,
    // A one-time ticket that lets the browser with this record into the
    // `role` pane, landing on `to`, a path on that pane.
    enter: (record, role, to) => mint('enter', { record, role, to }, ENTER_TTL_MS).ticket,
    // { to, paneToken } for a live enter ticket of this role; it is spent
    // whatever the role, so one shown to the wrong pane is gone.
    redeemEnter(value, role) {
      const ticket = spend(value, 'enter')
      if (ticket === null || ticket.role !== role) return null
      return { to: ticket.to, paneToken: ticket.record.paneToken }
    },
    // { ticket, expiresAt } for an invite link an enrolled browser hands out.
    invite: () => mint('invite', {}, INVITE_TTL_MS),
    // A new browser's harness token for a live invite, else null.
    redeemInvite: value => (spend(value, 'invite') === null ? null : enrol()),
  }
}
