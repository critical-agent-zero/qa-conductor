import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createGithub } from '../lib/github.mjs'

const TOKEN = 'test-token'
const REPO = 'acme/widget'
const PACKAGE = 'widget-app'
const API = 'https://api.github.com'

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body)
    },
  }
}

function makeFetch(responder) {
  const calls = []
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options })
    return responder(url, options, calls.length)
  }
  return { calls, fetchFn }
}

function assertGithubHeaders(options) {
  assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`)
  assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28')
  assert.equal(options.headers.Accept, 'application/vnd.github+json')
}

function version(id, tags, updatedAt) {
  return { id, updated_at: updatedAt, metadata: { container: { tags } } }
}

test('listOpenPrs fetches open PRs and maps the fields, including the trust data', async () => {
  const { calls, fetchFn } = makeFetch(() =>
    response(200, [
      {
        number: 41, title: 'Add widgets', author_association: 'MEMBER', user: { login: 'alice' },
        head: { sha: 'abc123', ref: 'feat/widgets', repo: { full_name: 'acme/widget', owner: { login: 'acme' } } },
      },
      {
        number: 42, title: 'Fix bug', author_association: 'CONTRIBUTOR', user: { login: 'bob' },
        head: { sha: 'def456', ref: 'fix/bug', repo: { full_name: 'bob/widget', owner: { login: 'bob' } } },
      },
      // a PR whose head repository was deleted: GitHub sends head.repo = null
      { number: 43, title: 'Orphan', author_association: 'NONE', user: { login: 'eve' }, head: { sha: 'fed789', ref: 'x', repo: null } },
    ]),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  const prs = await gh.listOpenPrs()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${API}/repos/${REPO}/pulls?state=open&per_page=50`)
  assert.equal(calls[0].options.method, 'GET')
  assertGithubHeaders(calls[0].options)
  assert.deepEqual(prs, [
    { number: 41, title: 'Add widgets', headSha: 'abc123', headRef: 'feat/widgets', author: 'alice', authorAssociation: 'MEMBER', headRepo: 'acme/widget', headOwner: 'acme' },
    { number: 42, title: 'Fix bug', headSha: 'def456', headRef: 'fix/bug', author: 'bob', authorAssociation: 'CONTRIBUTOR', headRepo: 'bob/widget', headOwner: 'bob' },
    { number: 43, title: 'Orphan', headSha: 'fed789', headRef: 'x', author: 'eve', authorAssociation: 'NONE', headRepo: null, headOwner: null },
  ])
})

test('prInfo returns the PR trust data from GET /pulls/{num}', async () => {
  const { calls, fetchFn } = makeFetch(() => response(200, {
    number: 41, draft: true, author_association: 'COLLABORATOR', user: { login: 'alice' },
    head: { sha: 'feedfacecafe0123456789abcdef0123456789ab', ref: 'feat', repo: { full_name: 'alice/widget', owner: { login: 'alice' } } },
  }))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn })
  const info = await gh.prInfo(41)
  assert.equal(calls[0].url, `${API}/repos/${REPO}/pulls/41`)
  assert.equal(calls[0].options.method, 'GET')
  assertGithubHeaders(calls[0].options)
  assert.deepEqual(info, {
    number: 41,
    headSha: 'feedfacecafe0123456789abcdef0123456789ab',
    author: 'alice',
    authorAssociation: 'COLLABORATOR',
    isDraft: true,
    headRepo: 'alice/widget',
    headOwner: 'alice',
  })
})

test('prInfo: a deleted head repository gives null headRepo and headOwner', async () => {
  const { fetchFn } = makeFetch(() => response(200, {
    number: 9, draft: false, author_association: 'NONE', user: { login: 'eve' }, head: { sha: 'a'.repeat(40), ref: 'x', repo: null },
  }))
  const info = await createGithub({ token: TOKEN, repo: REPO, fetchFn }).prInfo(9)
  assert.equal(info.headRepo, null)
  assert.equal(info.headOwner, null)
  assert.equal(info.isDraft, false)
  assert.equal(info.author, 'eve')
})

test('prInfo throws on a non-2xx response', async () => {
  const { fetchFn } = makeFetch(() => response(404, { message: 'Not Found' }))
  await assert.rejects(createGithub({ token: TOKEN, repo: REPO, fetchFn }).prInfo(9), /404/)
})

test('authorPermission returns the top-level permission for a login', async () => {
  const { calls, fetchFn } = makeFetch(() => response(200, { permission: 'write', role_name: 'maintain', user: { login: 'alice' } }))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn })
  assert.equal(await gh.authorPermission('alice'), 'write')
  assert.equal(calls[0].url, `${API}/repos/${REPO}/collaborators/alice/permission`)
  assert.equal(calls[0].options.method, 'GET')
  assertGithubHeaders(calls[0].options)
})

test('authorPermission encodes the login into the path', async () => {
  const { calls, fetchFn } = makeFetch(() => response(200, { permission: 'none' }))
  assert.equal(await createGithub({ token: TOKEN, repo: REPO, fetchFn }).authorPermission('a/../b'), 'none')
  assert.equal(calls[0].url, `${API}/repos/${REPO}/collaborators/a%2F..%2Fb/permission`)
})

test('authorPermission throws on a non-2xx response', async () => {
  const { fetchFn } = makeFetch(() => response(403, { message: 'Must have push access to view collaborator permission.' }))
  await assert.rejects(createGithub({ token: TOKEN, repo: REPO, fetchFn }).authorPermission('alice'), /403/)
})

test('non-2xx responses throw with status and body snippet', async () => {
  const { fetchFn } = makeFetch(() => response(500, { message: 'kaboom' }))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  await assert.rejects(gh.listOpenPrs(), (err) => {
    assert.match(err.message, /500/)
    assert.match(err.message, /kaboom/)
    return true
  })
})

test('prHead fetches the PR and returns head sha', async () => {
  const { calls, fetchFn } = makeFetch(() => response(200, { number: 41, head: { sha: 'feedfacecafe0123456789abcdef0123456789ab' } }))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  const sha = await gh.prHead(41)
  assert.equal(calls[0].url, `${API}/repos/${REPO}/pulls/41`)
  assert.equal(calls[0].options.method, 'GET')
  assertGithubHeaders(calls[0].options)
  assert.equal(sha, 'feedfacecafe0123456789abcdef0123456789ab')
})

test('ghcrTagExists returns true when a version carries the tag', async () => {
  const { calls, fetchFn } = makeFetch(() =>
    response(200, [version(1, ['1.4.0-rc.9'], '2026-09-01T00:00:00Z'), version(2, ['pr-41-abcdefabcdef'], '2026-09-02T00:00:00Z')]),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  assert.equal(await gh.ghcrTagExists('pr-41-abcdefabcdef'), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${API}/user/packages/container/widget-app/versions?per_page=100&page=1`)
  assert.equal(calls[0].options.method, 'GET')
  assertGithubHeaders(calls[0].options)
})

test('ghcrTagExists targets the configured package name', async () => {
  const { calls, fetchFn } = makeFetch(() => response(200, [version(1, ['pr-9-abc'], '2026-09-01T00:00:00Z')]))
  const gh = createGithub({ token: TOKEN, repo: 'acme/widget', fetchFn, packageName: 'widget-app' })
  await gh.ghcrTagExists('pr-9-abc')
  assert.equal(calls[0].url, `${API}/user/packages/container/widget-app/versions?per_page=100&page=1`)
})

test('ghcrTagExists paginates until a short page, false when absent', async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => version(i, [`other-${i}`], '2026-09-01T00:00:00Z'))
  const { calls, fetchFn } = makeFetch((url) =>
    url.endsWith('page=1') ? response(200, fullPage) : response(200, [version(200, ['still-not-it'], '2026-09-01T00:00:00Z')]),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  assert.equal(await gh.ghcrTagExists('pr-7-000000000000'), false)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, `${API}/user/packages/container/widget-app/versions?per_page=100&page=1`)
  assert.equal(calls[1].url, `${API}/user/packages/container/widget-app/versions?per_page=100&page=2`)
})

test('ghcrTagExists finds the tag on a later page', async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => version(i, [`other-${i}`], '2026-09-01T00:00:00Z'))
  const { calls, fetchFn } = makeFetch((url) =>
    url.endsWith('page=1') ? response(200, fullPage) : response(200, [version(200, ['pr-7-000000000000'], '2026-09-01T00:00:00Z')]),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  assert.equal(await gh.ghcrTagExists('pr-7-000000000000'), true)
  assert.equal(calls.length, 2)
})

const RC_VERSIONS = [
  version(1, ['1.4.0-rc.12'], '2026-09-10T00:00:00Z'),
  version(2, ['pr-41-abcdefabcdef'], '2026-09-21T00:00:00Z'),
  version(3, ['1.4.0-rc.15'], '2026-09-20T00:00:00Z'),
  version(4, ['2.0.0-rc.3'], '2026-09-22T00:00:00Z'),
  version(5, ['latest', '1.3.0-rc.2'], '2026-09-01T00:00:00Z'),
]

test('latestRcTag picks the newest rc tag (any version line by default)', async () => {
  const { fetchFn } = makeFetch(() => response(200, RC_VERSIONS))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  assert.equal(await gh.latestRcTag(), '2.0.0-rc.3')
})

test('latestRcTag honours a configured rc tag pattern', async () => {
  const { fetchFn } = makeFetch(() => response(200, RC_VERSIONS))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE, rcTagPattern: /^1\..*-rc\.\d+$/ })
  assert.equal(await gh.latestRcTag(), '1.4.0-rc.15')
})

test('GHCR helpers require a packageName; non-GHCR calls do not', async () => {
  const { fetchFn } = makeFetch(() => response(200, []))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn })
  await assert.rejects(gh.ghcrTagExists('x'), /packageName is required/)
  await assert.rejects(gh.latestRcTag(), /packageName is required/)
  assert.deepEqual(await gh.listOpenPrs(), [])
})

test('preview workflow and ref are configurable', async () => {
  const { calls, fetchFn } = makeFetch(() => response(204, ''))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, previewWorkflow: 'preview.yml', previewRef: 'trunk' })
  await gh.dispatchPreviewBuild(41)
  assert.equal(calls[0].url, `${API}/repos/${REPO}/actions/workflows/preview.yml/dispatches`)
  assert.deepEqual(JSON.parse(calls[0].options.body), { ref: 'trunk', inputs: { pr: '41' } })
})

test('latestRcTag returns null when no rc tag exists', async () => {
  const { fetchFn } = makeFetch(() => response(200, [version(1, ['pr-41-abcdefabcdef'], '2026-09-21T00:00:00Z')]))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  assert.equal(await gh.latestRcTag(), null)
})

test('dispatchPreviewBuild POSTs the workflow dispatch', async () => {
  const { calls, fetchFn } = makeFetch(() => response(204, ''))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  await gh.dispatchPreviewBuild(41)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${API}/repos/${REPO}/actions/workflows/pr-preview.yml/dispatches`)
  assert.equal(calls[0].options.method, 'POST')
  assertGithubHeaders(calls[0].options)
  assert.deepEqual(JSON.parse(calls[0].options.body), { ref: 'main', inputs: { pr: '41' } })
})

test('awaitPreviewImage polls for pr-<num>-<sha12> and resolves when present', async () => {
  const sha = 'a'.repeat(40)
  const tag = `pr-41-${'a'.repeat(12)}`
  let attempts = 0
  const { fetchFn } = makeFetch(() => {
    attempts += 1
    return attempts < 3 ? response(200, []) : response(200, [version(9, [tag], '2026-09-22T00:00:00Z')])
  })
  const sleeps = []
  const sleepFn = async (ms) => sleeps.push(ms)
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  await gh.awaitPreviewImage(41, sha, { timeoutMs: 900000, pollMs: 15000, sleepFn })
  assert.equal(attempts, 3)
  assert.deepEqual(sleeps, [15000, 15000])
})

test('awaitPreviewImage throws after timeoutMs of polling', async () => {
  const { fetchFn } = makeFetch(() => response(200, []))
  const sleeps = []
  const sleepFn = async (ms) => sleeps.push(ms)
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  await assert.rejects(gh.awaitPreviewImage(41, 'b'.repeat(40), { timeoutMs: 45000, pollMs: 15000, sleepFn }), /timed out/)
  assert.deepEqual(sleeps, [15000, 15000, 15000])
})

test('findPreviewRun returns the newest run by created_at with mapped fields', async () => {
  const { calls, fetchFn } = makeFetch(() =>
    response(200, {
      workflow_runs: [
        {
          html_url: 'https://github.com/acme/widget/actions/runs/1',
          status: 'completed',
          conclusion: 'success',
          created_at: '2026-09-20T00:00:00Z',
          run_started_at: '2026-09-20T00:01:00Z',
          display_title: 'old preview',
          head_branch: 'main',
        },
        {
          html_url: 'https://github.com/acme/widget/actions/runs/2',
          status: 'in_progress',
          conclusion: null,
          created_at: '2026-09-22T00:00:00Z',
          run_started_at: '2026-09-22T00:01:00Z',
          display_title: 'newest preview',
          head_branch: 'main',
        },
      ],
    }),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  const run = await gh.findPreviewRun(41)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${API}/repos/${REPO}/actions/workflows/pr-preview.yml/runs?per_page=10`)
  assert.equal(calls[0].options.method, 'GET')
  assertGithubHeaders(calls[0].options)
  assert.deepEqual(run, {
    url: 'https://github.com/acme/widget/actions/runs/2',
    status: 'in_progress',
    conclusion: null,
    startedAt: '2026-09-22T00:01:00Z',
  })
})

test('findPreviewRun prefers a run referencing the PR over a newer unrelated run', async () => {
  const { fetchFn } = makeFetch(() =>
    response(200, [
      {
        html_url: 'https://github.com/acme/widget/actions/runs/3',
        status: 'completed',
        conclusion: 'success',
        created_at: '2026-09-22T00:00:00Z',
        run_started_at: '2026-09-22T00:00:30Z',
        display_title: 'unrelated build',
        head_branch: 'main',
      },
      {
        html_url: 'https://github.com/acme/widget/actions/runs/4',
        status: 'completed',
        conclusion: 'failure',
        created_at: '2026-09-21T00:00:00Z',
        run_started_at: '2026-09-21T00:00:30Z',
        display_title: 'preview for pull request',
        head_branch: 'pr-41',
      },
    ]),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  const run = await gh.findPreviewRun(41)
  assert.equal(run.url, 'https://github.com/acme/widget/actions/runs/4')
  assert.equal(run.conclusion, 'failure')
  assert.equal(run.startedAt, '2026-09-21T00:00:30Z')
})

test('findPreviewRun falls back to created_at and null conclusion when fields are missing', async () => {
  const { fetchFn } = makeFetch(() =>
    response(200, [
      { html_url: 'https://github.com/acme/widget/actions/runs/5', status: 'queued', created_at: '2026-09-23T00:00:00Z' },
    ]),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  const run = await gh.findPreviewRun(41)
  assert.deepEqual(run, {
    url: 'https://github.com/acme/widget/actions/runs/5',
    status: 'queued',
    conclusion: null,
    startedAt: '2026-09-23T00:00:00Z',
  })
})

test('findPreviewRun returns null when there are no runs', async () => {
  const { fetchFn } = makeFetch(() => response(200, { workflow_runs: [] }))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  assert.equal(await gh.findPreviewRun(41), null)
})

test('listPrImageTags flattens and dedups tags across one paginated walk', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) =>
    i === 0
      ? version(i, ['pr-41-aaaaaaaaaaaa', 'shared-tag'], '2026-09-01T00:00:00Z')
      : version(i, [`other-${i}`], '2026-09-01T00:00:00Z'),
  )
  const page2 = [
    version(200, ['pr-42-bbbbbbbbbbbb', 'shared-tag'], '2026-09-02T00:00:00Z'),
    version(201, ['pr-43-cccccccccccc'], '2026-09-02T00:00:00Z'),
  ]
  const { calls, fetchFn } = makeFetch((url) =>
    url.endsWith('page=1') ? response(200, page1) : response(200, page2),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  const tags = await gh.listPrImageTags()
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, `${API}/user/packages/container/widget-app/versions?per_page=100&page=1`)
  assert.equal(calls[1].url, `${API}/user/packages/container/widget-app/versions?per_page=100&page=2`)
  assert.ok(tags.includes('pr-41-aaaaaaaaaaaa'))
  assert.ok(tags.includes('pr-42-bbbbbbbbbbbb'))
  assert.ok(tags.includes('pr-43-cccccccccccc'))
  assert.equal(tags.filter((t) => t === 'shared-tag').length, 1)
})

test('listPrImageTags returns an empty array when there are no versions', async () => {
  const { calls, fetchFn } = makeFetch(() => response(200, []))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  assert.deepEqual(await gh.listPrImageTags(), [])
  assert.equal(calls.length, 1)
})

test('postComment POSTs the body and returns html_url', async () => {
  const { calls, fetchFn } = makeFetch(() => response(201, { html_url: 'https://github.com/acme/widget/pull/41#issuecomment-1' }))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  const url = await gh.postComment(41, 'QA verdict body')
  assert.equal(calls[0].url, `${API}/repos/${REPO}/issues/41/comments`)
  assert.equal(calls[0].options.method, 'POST')
  assertGithubHeaders(calls[0].options)
  assert.deepEqual(JSON.parse(calls[0].options.body), { body: 'QA verdict body' })
  assert.equal(url, 'https://github.com/acme/widget/pull/41#issuecomment-1')
})

test('setQaLabel adds the label and deletes the opposite', async () => {
  const { calls, fetchFn } = makeFetch((url, options) =>
    options.method === 'POST' ? response(200, [{ name: 'qa-approved' }]) : response(200, []),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  await gh.setQaLabel(41, 'qa-approved')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, `${API}/repos/${REPO}/issues/41/labels`)
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].options.body), { labels: ['qa-approved'] })
  assert.equal(calls[1].url, `${API}/repos/${REPO}/issues/41/labels/qa-changes-requested`)
  assert.equal(calls[1].options.method, 'DELETE')
  assertGithubHeaders(calls[1].options)
})

test('setQaLabel qa-changes-requested removes qa-approved', async () => {
  const { calls, fetchFn } = makeFetch((url, options) =>
    options.method === 'POST' ? response(200, [{ name: 'qa-changes-requested' }]) : response(200, []),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  await gh.setQaLabel(41, 'qa-changes-requested')
  assert.deepEqual(JSON.parse(calls[0].options.body), { labels: ['qa-changes-requested'] })
  assert.equal(calls[1].url, `${API}/repos/${REPO}/issues/41/labels/qa-approved`)
})

test('setQaLabel honours a configured label pair and removes its opposite', async () => {
  const { calls, fetchFn } = makeFetch(() => response(200, []))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, qaLabels: ['ok', 'nope'] })
  await gh.setQaLabel(41, 'ok')
  assert.deepEqual(JSON.parse(calls[0].options.body), { labels: ['ok'] })
  assert.equal(calls[1].url, `${API}/repos/${REPO}/issues/41/labels/nope`)
  await assert.rejects(gh.setQaLabel(41, 'qa-approved'), /unknown QA label/)
})

test('setQaLabel tolerates 404 when the opposite label is absent', async () => {
  const { calls, fetchFn } = makeFetch((url, options) =>
    options.method === 'POST' ? response(200, [{ name: 'qa-approved' }]) : response(404, { message: 'Label does not exist' }),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  await gh.setQaLabel(41, 'qa-approved')
  assert.equal(calls.length, 2)
})

test('setQaLabel throws when the opposite-label delete fails with non-404', async () => {
  const { fetchFn } = makeFetch((url, options) =>
    options.method === 'POST' ? response(200, [{ name: 'qa-approved' }]) : response(500, { message: 'server error' }),
  )
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  await assert.rejects(gh.setQaLabel(41, 'qa-approved'), /500/)
})

test('setQaLabel rejects an unknown label', async () => {
  const { calls, fetchFn } = makeFetch(() => response(200, []))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  await assert.rejects(gh.setQaLabel(41, 'qa-something-else'), /label/)
  assert.equal(calls.length, 0)
})

test('awaitPreviewImage stops promptly when its signal is aborted', async () => {
  const ac = new AbortController()
  let polls = 0
  const { fetchFn } = makeFetch(() => { polls++; return response(200, []) })
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: PACKAGE })
  const sleepFn = async () => { if (polls >= 2) ac.abort() }
  await assert.rejects(
    gh.awaitPreviewImage(41, 'abcdefabcdef0000', { sleepFn, signal: ac.signal, timeoutMs: 1e9 }),
    err => err.name === 'AbortError',
  )
  assert.equal(polls, 2)
})

// A fine-grained PAT cannot call the Packages API, so the package versions
// listing can take its own token (a classic PAT with read:packages).
test('packagesToken authorizes only the package versions listing; token every repo call', async () => {
  const sha = 'a'.repeat(40)
  const { calls, fetchFn } = makeFetch((url, options) => {
    if (url.startsWith(`${API}/user/packages/`)) return response(200, [version(1, ['1.4.0-rc.1', `pr-41-${sha.slice(0, 12)}`], '2026-09-01T00:00:00Z')])
    if (url.endsWith('/dispatches')) return response(204, '')
    if (url.includes('/runs?')) return response(200, { workflow_runs: [] })
    if (url.includes('/pulls/')) return response(200, { number: 41, head: { sha } })
    if (url.endsWith('/comments')) return response(201, { html_url: 'https://github.com/acme/widget/pull/41#issuecomment-1' })
    if (options.method === 'DELETE') return response(404, { message: 'Label does not exist' })
    return response(200, [])
  })
  const gh = createGithub({ token: 'repo-token', packagesToken: 'packages-token', repo: REPO, fetchFn, packageName: 'app' })

  await gh.listOpenPrs()
  await gh.prHead(41)
  await gh.dispatchPreviewBuild(41)
  await gh.findPreviewRun(41)
  await gh.postComment(41, 'QA verdict body')
  await gh.setQaLabel(41, 'qa-approved')
  const repoCalls = calls.length
  await gh.ghcrTagExists('pr-41-000000000000')
  await gh.latestRcTag()
  await gh.listPrImageTags()
  await gh.awaitPreviewImage(41, sha, { sleepFn: async () => {} })

  assert.equal(repoCalls, 7)
  assert.equal(calls.length, 11)
  for (const [i, { url, options }] of calls.entries()) {
    const packages = url.startsWith(`${API}/user/packages/container/app/versions?`)
    assert.equal(packages, i >= repoCalls, url)
    assert.equal(options.headers.Authorization, `Bearer ${packages ? 'packages-token' : 'repo-token'}`, `${options.method} ${url}`)
  }
})

test('without a packagesToken, token authorizes the package versions listing too', async () => {
  const { calls, fetchFn } = makeFetch(() => response(200, []))
  const gh = createGithub({ token: TOKEN, repo: REPO, fetchFn, packageName: 'app' })
  await gh.listPrImageTags()
  await gh.listOpenPrs()
  assert.deepEqual(calls.map(c => c.options.headers.Authorization), [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`])
})
