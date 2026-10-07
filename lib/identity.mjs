// Tailscale identity gate for the harness and both pane proxies.
//
// tailscale serve sets Tailscale-User-Login on the requests it proxies from a
// user's device, strips any copy the client sent, and sets none for tagged
// devices. The header can be trusted only because the conductor listens on
// loopback (cfg.host), so serve on the same host is the only way in.
//
// The allowlist is cfg.allowedLogins, from the comma-separated
// QA_ALLOWED_LOGINS. Its refusal strings are part of the 403 body a viewer
// sees, so test/identity.test.mjs pins them.

const LOGIN_HEADER = 'tailscale-user-login'

function headerValue(headers, name) {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value.join(', ') : String(value)
  }
  return undefined
}

export function normalizeLogins(list) {
  return (list ?? []).map(login => String(login).trim().toLowerCase()).filter(Boolean)
}

// Why a request must be refused, or null to serve it. An empty allowlist
// refuses everyone.
export function refusalReason(headers, allowlist) {
  const login = headerValue(headers, LOGIN_HEADER)?.trim()
  if (!login) return 'no Tailscale identity: open this through tailscale serve from an allowed user\'s device'
  if (!normalizeLogins(allowlist).includes(login.toLowerCase())) return `${login} is not in QA_ALLOWED_LOGINS`
  return null
}

export function isAllowed(headers, allowlist) {
  return refusalReason(headers, allowlist) === null
}

// Wraps a request handler so that only allowed logins reach it; the rest get
// a short plain-text 403 that carries no conductor state.
export function identityGate(handler, allowlist) {
  return (req, res) => {
    const reason = refusalReason(req.headers, allowlist)
    if (reason === null) return handler(req, res)
    res.writeHead(403, {
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    })
    res.end(`403: ${reason}\n`)
  }
}
