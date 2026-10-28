R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'
CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1'
SETUP = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0'

JOB = """
  # The Docker Provisioner's internal network on a real runtime (#32):
  # Docker Engine, and Podman through its Docker-compatible socket with the
  # docker CLI pointed at it. The test runs only when asked (QA_DOCKER_IT),
  # fails rather than skips when asked and no runtime answers, and the last
  # step fails the job on any skip.
  docker-integration:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        runtime: [docker, podman]
    steps:
      - uses: CHECKOUT
        with:
          persist-credentials: false
      - uses: SETUP
        with:
          node-version: 22
      - if: matrix.runtime == 'podman'
        run: |
          sudo systemctl stop docker.socket docker.service
          sudo systemctl start podman.socket
          sudo chmod 666 /run/podman/podman.sock
      - run: node --test --test-force-exit --test-reporter=spec test/integration/docker-internal.test.mjs | tee it.log
        shell: bash
        env:
          QA_DOCKER_IT: "1"
          DOCKER_HOST: ${{ matrix.runtime == 'podman' && 'unix:///run/podman/podman.sock' || '' }}
          DOCKER_BUILDKIT: ${{ matrix.runtime == 'podman' && '0' || '1' }}
      - run: grep -qx 'ℹ skipped 0' it.log
""".replace('CHECKOUT', CHECKOUT).replace('SETUP', SETUP)

p = R + '.github/workflows/ci.yml'
s = open(p).read()
assert s.endswith('          CI_EXPECTS_PUBLISH_NPM: "true"\n'), repr(s[-80:])
s = s + JOB
open(p, 'w').write(s)

# the package test pins the whole jobs block: add the new job's lines
p = R + 'test/package.test.mjs'
s = open(p).read()
a = """    '        run: node --test test/package.test.mjs',
    '        env:',
    "          CI_EXPECTS_PUBLISH_NPM: \\"true\\"",
  ])"""
if s.count(a) != 1:
    a = """    '        run: node --test test/package.test.mjs',
    '        env:',
    '          CI_EXPECTS_PUBLISH_NPM: "true"',
  ])"""
assert s.count(a) == 1, s.count(a)
pinned = [line for line in JOB.split('\n') if line.strip() and not line.strip().startswith('#')]
def jsq(line):
    masked = line.replace('@3d3c42e5aac5ba805825da76410c181273ba90b1', '@<sha>').replace('@820762786026740c76f36085b0efc47a31fe5020', '@<sha>')
    if "'" in masked:
        return '    ' + '"' + masked.replace('\\', '\\\\').replace('"', '\\"') + '",'
    return "    '" + masked + "',"
b = a[:-len('  ])')] + '\n'.join(jsq(line) for line in pinned) + '\n  ])'
s = s.replace(a, b)
s = s.replace("""// CI's Node 22 leg runs the suite as publish.yml's test job does, with Node
// 22's own npm, which packs the release.""", """// CI's Node 22 leg runs the suite as publish.yml's test job does, with Node
// 22's own npm, which packs the release. (The docker-integration job, pinned
// with it, runs the internal network's test on a real runtime.)""")
open(p, 'w').write(s)
print('ok')
