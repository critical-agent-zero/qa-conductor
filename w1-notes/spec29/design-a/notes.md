design-a (capability-first) working notes
- crux 1: minting. Anything reaching loopback can "open the harness"; Fetch Metadata/login are forgeable. Discriminator = time: enrol only while no PR code can run (idle, sweep done, last teardown ok).
- crux 2: cookies ignore ports. On http loopback, PR page + PR listener (Docker Desktop published app port 127.0.0.1:3112, any port for process prov) lift HttpOnly host cookies via <img>. https/tailnet: Secure cookies never reach PR listener (no TLS for host.ts.net).
- => harness uses header token (localStorage of harness origin), not a cookie; panes need cookies (navigations/subresources).
- base app published 127.0.0.1:3111 (provisioner-docker.mjs:194) is NOT a conductor listener: capability doesn't cover it.
- homefree: compose network_mode: host, bind 127.0.0.1, native Linux Docker, harness :8444/qa shares port with another app's /.
- Clear-Site-Data from pane app could wipe capability -> proxy should drop it.
- teardownSession swallows errors (session.mjs ~209, server doTeardown) -> need ok/failed for enrol window.
- server.test.mjs: 183 /api/ refs -> enrol helper.
