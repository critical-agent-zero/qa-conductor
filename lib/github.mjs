// GitHub API client for the QA conductor. All effects go through the injected
// fetchFn (and sleepFn for polling) so tests never touch the network.

const API = 'https://api.github.com'

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// `packageName` is the GHCR container package the GHCR helpers (tag lookup,
// RC baseline, preview-image wait) read; only those helpers need it. The
// versions endpoint is the authed-user path (`/user/...`); GHCR-under-an-org
// would need `/orgs/{owner}/...` — a follow-up when a consumer needs it.
//
// `token` authorizes the repo calls (pulls, collaborators, workflow dispatch
// and runs, issue comments and labels). `packagesToken` authorizes only the
// package versions listing, which a fine-grained PAT cannot call: pass a
// classic PAT with read:packages there (cfg.ghcrToken). It defaults to
// `token`.
export function createGithub({
  token,
  packagesToken = token,
  repo,
  fetchFn = fetch,
  packageName = null,
  // which GHCR tags count as release candidates for latestRcTag
  rcTagPattern = /-rc\.\d+$/,
  // the workflow that builds PR preview images, and the ref it is dispatched on
  previewWorkflow = 'pr-preview.yml',
  previewRef = 'main',
  // the exclusive verdict label pair: [accept, reject]
  qaLabels = ['qa-approved', 'qa-changes-requested'],
}) {
  const packageVersionsPath = () => {
    if (!packageName) throw new Error('createGithub: packageName is required for GHCR lookups')
    return `/user/packages/container/${packageName}/versions`
  }
  async function request(method, path, body, auth = token) {
    return fetchFn(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${auth}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  async function requestJson(method, path, body, auth = token) {
    const res = await request(method, path, body, auth)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`github ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`)
    }
    if (res.status === 204) return null
    return res.json()
  }

  async function* packageVersions() {
    for (let page = 1; ; page++) {
      const versions = await requestJson('GET', `${packageVersionsPath()}?per_page=100&page=${page}`, undefined, packagesToken)
      for (const version of versions) yield version
      if (versions.length < 100) return
    }
  }

  function versionTags(version) {
    return version.metadata?.container?.tags ?? []
  }

  // Who opened a PR and where its head lives: the inputs a BuildConvention's
  // trust gate judges. head.repo is null when the head repository was deleted.
  function trustFields(pr) {
    return {
      authorAssociation: pr.author_association ?? null,
      headRepo: pr.head.repo?.full_name ?? null,
      headOwner: pr.head.repo?.owner?.login ?? null,
    }
  }

  async function listOpenPrs() {
    const prs = await requestJson('GET', `/repos/${repo}/pulls?state=open&per_page=50`)
    return prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headSha: pr.head.sha,
      headRef: pr.head.ref,
      author: pr.user.login,
      ...trustFields(pr),
    }))
  }

  async function prHead(num) {
    const pr = await requestJson('GET', `/repos/${repo}/pulls/${num}`)
    return pr.head.sha
  }

  async function prInfo(num) {
    const pr = await requestJson('GET', `/repos/${repo}/pulls/${num}`)
    const { authorAssociation, headRepo, headOwner } = trustFields(pr)
    return {
      number: pr.number,
      headSha: pr.head.sha,
      author: pr.user?.login ?? null,
      authorAssociation,
      isDraft: Boolean(pr.draft),
      headRepo,
      headOwner,
    }
  }

  // The login's effective permission on the repo: admin | write | read | none.
  // author_association alone is no access check (a read-only outside
  // collaborator is still COLLABORATOR), so trust gates ask this too.
  async function authorPermission(login) {
    const res = await requestJson('GET', `/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`)
    return res.permission
  }

  async function ghcrTagExists(tag) {
    for await (const version of packageVersions()) {
      if (versionTags(version).includes(tag)) return true
    }
    return false
  }

  async function latestRcTag() {
    let bestTag = null
    let bestUpdated = ''
    for await (const version of packageVersions()) {
      const tag = versionTags(version).find((t) => rcTagPattern.test(t))
      if (tag && (!bestTag || version.updated_at > bestUpdated)) {
        bestTag = tag
        bestUpdated = version.updated_at
      }
    }
    return bestTag
  }

  async function dispatchPreviewBuild(num) {
    await requestJson('POST', `/repos/${repo}/actions/workflows/${previewWorkflow}/dispatches`, {
      ref: previewRef,
      inputs: { pr: String(num) },
    })
  }

  async function awaitPreviewImage(num, sha, { timeoutMs = 900000, pollMs = 15000, sleepFn = defaultSleep, signal } = {}) {
    const tag = `pr-${num}-${sha.slice(0, 12)}`
    let waited = 0
    for (;;) {
      // A cancelled boot (teardown/takeover) must stop polling promptly rather
      // than hold its wait for up to timeoutMs.
      if (signal?.aborted) throw Object.assign(new Error(`aborted waiting for GHCR tag ${tag}`), { name: 'AbortError' })
      if (await ghcrTagExists(tag)) return tag
      if (waited >= timeoutMs) throw new Error(`timed out after ${timeoutMs}ms waiting for GHCR tag ${tag}`)
      await sleepFn(pollMs)
      waited += pollMs
    }
  }

  function runReferencesPr(run, num) {
    const hay = `${run.display_title ?? ''} ${run.head_branch ?? ''} ${run.name ?? ''}`
    return new RegExp(`(^|[^0-9])${num}([^0-9]|$)`).test(hay)
  }

  async function findPreviewRun(num) {
    const data = await requestJson('GET', `/repos/${repo}/actions/workflows/${previewWorkflow}/runs?per_page=10`)
    const runs = Array.isArray(data) ? data : (data?.workflow_runs ?? [])
    if (runs.length === 0) return null
    const byRecency = [...runs].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    const chosen = byRecency.find((run) => runReferencesPr(run, num)) ?? byRecency[0]
    return {
      url: chosen.html_url,
      status: chosen.status,
      conclusion: chosen.conclusion ?? null,
      startedAt: chosen.run_started_at ?? chosen.created_at,
    }
  }

  async function listPrImageTags() {
    const tags = new Set()
    for await (const version of packageVersions()) {
      for (const tag of versionTags(version)) tags.add(tag)
    }
    return [...tags]
  }

  async function postComment(num, body) {
    const comment = await requestJson('POST', `/repos/${repo}/issues/${num}/comments`, { body })
    return comment.html_url
  }

  async function setQaLabel(num, label) {
    if (!qaLabels.includes(label)) throw new Error(`unknown QA label: ${label}`)
    const opposite = qaLabels.find((l) => l !== label)
    await requestJson('POST', `/repos/${repo}/issues/${num}/labels`, { labels: [label] })
    const res = await request('DELETE', `/repos/${repo}/issues/${num}/labels/${encodeURIComponent(opposite)}`)
    if (!res.ok && res.status !== 404) {
      const text = await res.text()
      throw new Error(`github DELETE label ${opposite} -> ${res.status}: ${text.slice(0, 200)}`)
    }
  }

  return {
    listOpenPrs,
    prHead,
    prInfo,
    authorPermission,
    ghcrTagExists,
    latestRcTag,
    dispatchPreviewBuild,
    awaitPreviewImage,
    findPreviewRun,
    listPrImageTags,
    postComment,
    setQaLabel,
  }
}
