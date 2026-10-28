R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:100], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('.github/workflows/ci.yml', [
    ("""      - if: matrix.runtime == 'podman'
        run: |
          sudo systemctl stop docker.socket docker.service
          sudo systemctl start podman.socket
          sudo chmod 666 /run/podman/podman.sock
      - run: node --test""", """      - if: matrix.runtime == 'podman'
        run: |
          sudo systemctl stop docker.socket docker.service
          sudo systemctl start podman.socket
          sudo chmod a+x /run/podman
          sudo chmod a+rw /run/podman/podman.sock
      - run: docker version
        env:
          DOCKER_HOST: ${{ matrix.runtime == 'podman' && 'unix:///run/podman/podman.sock' || '' }}
      - run: node --test"""),
])
edit('test/package.test.mjs', [
    ("""    '          sudo systemctl start podman.socket',
    '          sudo chmod 666 /run/podman/podman.sock',
    '      - run: node --test""", """    '          sudo systemctl start podman.socket',
    '          sudo chmod a+x /run/podman',
    '          sudo chmod a+rw /run/podman/podman.sock',
    '      - run: docker version',
    '        env:',
    "          DOCKER_HOST: ${{ matrix.runtime == 'podman' && 'unix:///run/podman/podman.sock' || '' }}",
    '      - run: node --test"""),
])
print('ok')
