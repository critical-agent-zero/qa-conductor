# Ledger: BABYSIT #35 -> #36 -> #37, round-3 findings (order received 2026-10-21)

Order: merge main 561bd84 into #35 (agent/w1-issue-8b, 2ec0bba), then #35 -> #36 (8c, a2bbc7c) -> #37 (8d, fc2cc1a).
Merge, never rebase. Re-check diff vs base before each push. Regression test per fix. --test-force-exit. Reply item by item as bot.
SendMessage the coordinator one line as each PR is pushed and replied. Stop after #37. #42 paused. Don't push #40/#41.
Worktree: w1/repo. Evidence: run/review-35c, 36c, 37c.
Done before this order: #40 20f945b, #41 d908a01, #43 filed (reported).

## #35 items
- [ ] merge main
- [ ] H1 KEY_IN_TEXT quadratic -> fix regex (use the verifier's better form keeping single-backslash keys), timing tests (\\ runs + '=' and + '"'), key after a single backslash, CHANGELOG "linear"
- [ ] M2 omitted collections visible (omitted list / name stubs) -> 'unknown' red unverified; test S1 omitted / Sn wiped
- [ ] M3 fold PR-only stubs into one summary flag with count; order by kind within severity; base collections before PR-only
- [ ] L enc:2 for double-encoded JSON text
- [ ] L value masking misses (empty-user/@ pw URLs, token-only userinfo, bearer case, AWS Name/Key Value, XML ns/attrs, &quot;), "Basic introduction" over-mask (token-like value)
- [ ] L README:437 + flagChanges JSDoc both-cut amber
- [ ] L masker cache: don't cache names >128 chars
- [ ] L survivors: stub inspector count, diffSnapshots linear-fields half, 'password : x', Basic/Token, unverified for dropped, shared ignoring countBefore
- [ ] nit README Severity: volatile presence for timestamps

## #36 items
## #37 items

## PAUSED (owner's order), 2026-10-21
- #35 WIP committed 2988320 (on f0296cd = merge of main 561bd84 into 8b) and pushed to fork agent/w1-issue-8b-r3-wip
  (not 8b-wip: that holds an older Oct-15 WIP 9551ae8 that a force-push would have overwritten).
- PR branch agent/w1-issue-8b untouched on the fork (still 2ec0bba). f0296cd merge is local only.
- Done in the WIP: every #35 item (H1, M2 omitted, M3 fold+order, enc:2, masking, cache, caps for #36 M1, README/CHANGELOG, survivor tests). data-diff 54/54 on Node 24.
- Left: mutation run (mut-35.json, 42 mutants, interrupted at A1; source restored), full suite on 22/24, deliver (deliver8.sh), reply, then #36 and #37.
- No processes left.

## RESUMED 2026-10-22
- #35 DONE: 7193877 pushed to agent/w1-issue-8b (WIP soft-reset into one proper commit), CI green, reply 6339977511, body updated, SendMessage sent.
- #43 body edited (zsh arrays, 3190/3199, echo $?, by-address 1c, 1g stderr). Done.
- #41 lows: wait for #40's round-2 verdict (do at once if APPROVE). Evidence run/review-41b.
- Next: #36 (8c) round 3: merge 7193877 into 8c, fix, push, reply; then #37 (8d).

## 2026-10-22 progress
- #36 DONE: 7055c24 pushed, CI green, reply 6340303860, body updated, SendMessage sent.
- NEW ORDER (owner decisions): #36 -> #40 round 2 + A (real-Docker CI test, Podman job if feasible, README labels) -> #41 lows + B (macOS 14/15 CI job for the sandbox docs test, must FAIL if skipped; README Checked; edit #43 to narrow) -> #37.
  Batch so each PR head moves once. Workflow pushes: bot PAT fallback with per-invocation -c flags if 403.
- #40 verdict not in yet (as of 7055c24 push). #41 round-2 verdict in (comment on #41, 2026-10-22 11:40): lows = tag check body, nested-Seatbelt skip (exit 71 probe), nits (both families all 5 ports, tie param names, chown root:wheel/chmod 755, optional #8 note).

## #40 A (in progress, 2026-10-22)
- Local commits on agent/w1-issue-32b past 20f945b: eea0583 (it test + ci job), c929170 (exit-status noise fix + README where-checked), then wip commits (to FOLD via soft reset before the PR push).
- Fork scratch branch agent/w1-it-wip (it-wip.sh rebuilds it: base + ci.yml push trigger). Fork CI green at 2df06b1 on docker AND podman; pinned run 488c209 in flight.
- Findings: docker CLI 'exit status 1' noise broke sweep (fixed); Podman 4.9 DNS forwards outside names (fixed: --dns + --add-host on Podman; README + PR body must say CI disproved round-1 claim); host bridge address reachable for 0.0.0.0 services (README limit; probe reports it; pinned in CI).
- #41: local commit e329fb2 on agent/w1-issue-32c (sandbox docs test rework). Still to do: README tag check body, nested note, chown, macOS CI job (must fail on skip), Checked bullets, #43 edit (narrow), merge #40's final head.
- #40 verdict: NOT in yet as of the pinned run.

## status 2026-10-22 later
- #40: folded local commits 825afb0 (fix: sweep + Podman DNS) and d8c6a58 (test: real-runtime CI). Equal to the tree fork CI ran green (pinned run 488c209). Full suite 806 (3 skipped = integration) both Nodes. NOT pushed: waiting for the #40 round-2 verdict to fold in.
- #41: 32c = d908a01 + e329fb2 (sandbox test) + merge f2799c2 (of d8c6a58) + wip 8884cff (README lows + macos job) + wip fa0d7c9 (probe inside test). Fork scratch 0ac47ef queued on macOS runners. Fold wip commits before push. Then edit #43 (narrow), optional #8 comment.
- #37: e0b635c committed locally on 8d (merge d4ee418 of #36 7055c24). 901/901 both Nodes, 20/20 mutants. NOT pushed (order: after #41).

## 2026-10-22 evening
- #37 PUSHED e0b635c, CI green, reply 6341188144, body updated, SendMessage sent.
- #36 round 4 (comment 6341158113): local work in repo on 8c (uncommitted at this note): caches (session memo per version, boot span per settle+trust), rank by first-flag index across lists, bytes budget, reason fix, mutant tests, server event-loop test (4M cells; under load hold 1-3 s, bound 2.5 s -> raise to 4 s / 300 tables). Merged #35 prep 13a9118 (maxCells, linear tally, data-losing tier) as e52594d.
- #35 round 4 (comment 6341513501) NEW: ONE work-budget design. Items: TAG_IN_TEXT [^<>]; masking work budget (100k digests, 100k parses, heldJson bracket check, NDJSON first-line, skip own placeholders); column-dropped fold per collection; pair rule bound only for loose spellings (cookie 8 keys, SSM 7 keys); omitted: long names don't count, name->count map for left-out; heap overhead per row/cell; lows (16 mutants, QUOTE \* test, value residuals, secret shapes, README known gaps).
- Then merge #35 -> #36 -> #37, push each, reply each, one-liner each.
- #40: still waiting verdict. #41: macOS-14 rerun queued on fork (run 39779356945).

## 2026-10-22 W28=B + #40 verdict (checkpoint)
- OWNER W28=B: hostile-PR slowdowns/heap growth ACCEPTED + DOCUMENTED. Fix only clear secrets or hidden/benign-looking destructive changes.
  - #35 keep: TAG [^<>] + timing test; linear tally; column-dropped fold per collection + 1,600-col test (users delete in first 10); pair rule (bound only loose spellings; HAR cookie 8 keys, SSM); over-length names not counted toward mayOmit (+test); lows: masking mutants (QUOTE \\* first), value residuals, cheap secret shapes; README known gaps; README limit "Hostile PR data and the conductor's responsiveness".
  - #35 DROP: masking work budget (2), heap overhead (6), maxCells (in 13a9118, NOT pushed: remove it).
  - #36 keep: data-losing kinds first (with fold), fallback first 20; chosen() ranks red base-pane before PR-only; 1,000-dropped test; lows (rank across lists optional, bytes, mutants, reason). DROP: caches, per-build compare budget, server event-loop test. Judgment call E: worst-case time + README limit.
  - Replies say "W28=B: documented, not fixed" for dropped items.
- #35 checkpoint: 8b = 13a9118 (local, clean tree; round-4 work not started). 8c = 33ad66e (local).
- #40 verdict in (6341612759), no blocking: doing #40 lows now, then push #40, push #41, then back to #35.
- #37 round 4 REQUEST_CHANGES (6341656182; evidence run/review-37d): MEDIUM spanCollections re-ranks (rank red tables by index of first red flag in span.flags, then rows moved, amber, other statuses, same; let a flag open its table by name; test 300 empty new tables + users email rewrite, and 300 red-delete PR tables + users delete). Lows: late-baseline wording (baselines.pr === comparedAt w/o PR error; shared baseline time when equal); 'and N more flags' double-counts folded; cut markers never drawn; open table kept by name. Nits: test gaps M5 M15 M28 S3 S4 K6 C1; "panes have none"; doubled "too big to list"; UNREADABLE Map/hasOwn; divergence omitted.
- Order: #40 push -> #41 push -> #35 r4 (W28=B) -> #36 r4 -> #37 r4 with merge-up.

## 2026-10-22 late: #40 + #41 pushed
- #40 PUSHED 8a03d2d (round-2 lows folded) + 5d2df65 (README --dns note). CI green. Reply 6342340538 (edited to mention 5d2df65), body updated. Shim: verdict fixed (endpoint+gateways); shim teardown follow-up (podman rm -f with missing name exits 0, removes nothing) -> fails closed. Survivors I15c, I16.
- #41 PUSHED 1aa07c5 (98fcf40 round-2 lows+macOS job, merges eba87d3/e10379d, diag commit). CI green. Reply 6342538062, body updated. #43 narrowed (title+body). #8 note 6342512649.
- FINDING: upstream macos-14 on eba87d3 had BASE_APP over localhost 'connected' (1/3). Diagnostics in 1aa07c5. Fork loop re-running macos-14 on scratch 3aafd12 (notes/macos-loop.out). Report result to coordinator + #41.
- Next: #35 round 4 (W28=B) in repo on 8b (working tree has edits on top of 13a9118; plan: soft reset to 7193877 and commit once). Mutants mut-35r4b: survivors N3 N10 N18 N24 N25 N26 N29 N32 N34 to address.

## PAUSED (owner's order "pause all workers"), 2026-10-22
- #35 WIP 9451ac8 (on local 13a9118) pushed to fork agent/w1-issue-8b-r4-wip. PR branch 8b untouched (7193877).
- #36 local round-4 33ad66e (pre-W28=B: caches etc., must be reworked) pushed to fork agent/w1-issue-8c-r4-wip. PR branch 8c untouched (7055c24).
- #37 round 4: not started. PR branch 8d e0b635c.
- #40 5d2df65 and #41 1aa07c5 pushed, replied, CI green.
- macOS-14 diagnostics: fork run 39791030745 (scratch agent/w1-it-wip 3aafd12), first attempt only; my rerun loop stopped.
- No node --test / mutate / watch processes left.

## RESUMED 2026-10-22 evening
- #35 PUSHED 4a284f9 (fold on 7193877), CI green, reply 6345595506, body updated, one-liner sent.
- #36 rework checkpoint 3fb4711 (local, on c7059bb = merge 4a284f9 into 7055c24). Backups: w1-backup-8c-r4-33ad66e, w1-backup-8b-r4-9451ac8.
- BABYSIT #41 round 3 (6345856350, evidence run/review-41c): *: rule form for IPv4-mapped; macOS 14 not "Checked" until proven (30-round loop, diagnostics); advisory job; "Today" hedge; CHANGELOG #43 line; diag fields.
- #36 PUSHED 2b8379d, CI green, reply 6346159242, body updated.
- #41 PUSHED db5bfec, CI green, reply 6346171688 (macOS-14 loop count to append), body + #43 updated.
- #37 r4 WIP local 1931c0a on 8d (on merge 5ba172c of 2b8379d); tests not updated yet.
- NOW: #35 round 5 (6346159710, evidence run/review-35e).
- #35 PUSHED 4ed6449 (round 5), CI green, reply 6346432155, body updated.
- #36 PUSHED f9c79a5 (merge 4ed6449 + fieldsBefore strip), CI green, note 6346527434, body updated.
- #37 round 4 LOCAL f5ae305 on e7b7519 (merge f9c79a5 into e0b635c); tree = tested (Node 24 930/930; Node 22 2 timing fails under load 200+, rerun needed). Backup w1-backup-8d-r4-3be9ace. Reply/body not written yet.
- #41 APPROVED at db5bfec (6346747564): do not move head except #40 merge-up + README nits (:324 version qualifier, non-loopback address in test). #43 bar edited, count 8 posted. #41 body mutant sentence fixed.
- NOW: BABYSIT #40 round 3 (6346864438, evidence run/review-40c): HIGH shim rm (Podman<5.1); MEDIUM gateway_mode isolated on Engine 28+; MEDIUM direct route test; lows; nits.
- QUEUED: BABYSIT #36 round 5 (6346995789, evidence run/review-36e): one queue by whole rank across lists; seeded vs PR-own without base diff; amber seeded; await raw reads; lows; nits. Order: #40 r3 -> #41 merge-up -> #36 r5 -> #37 r4 merge-up.
- #40 PUSHED 102bc63 (round 3), CI green, reply 6347150041, body updated.
- #41 PUSHED d549750 (merge 102bc63 + 2 nits), reply draft notes/reply-41r4.md (post when CI done: CI_LINE).
- #36 r5 WIP local e48dba2 on f9c79a5.
- NOW: BABYSIT #35 round 6 (6347232740, evidence run/review-35f): DSN ':' restore; ATTR first; regression corpus test; differential fuzz vs 4a284f9 and 7193877; lows; nits.
