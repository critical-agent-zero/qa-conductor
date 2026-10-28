8a review (reviewer agent, 721/721, 20 mutants; scripts review/8a/probe.mjs, mutate.mjs, mut/)

F1 MED: paging `after` gives stale mark groupings (request seq'd at record; a mark up to 300 ms later regroups it).
  Fix: read(after) also returns requests with seq<=after and at >= (earliest new mark at) - window. Test: record /save at 900,
  read(0) mark null; mark at 1000; read(1).requests includes /save with mark 2.
F2 MED: 100 ms throttle per pane drops submit after click, click after change. Fix: throttle per (pane,type) or token bucket
  (burst ~4, 10/s) on both harness and conductor. Tests: harness posts click+submit 1 ms apart; log records change then click 60 ms later.
F3 LOW-MED: maxMarks shared: PR can exhaust (2000 in ~200 s), base starved. Fix: per-pane cap. Test: 2000 pr marks then base mark not null.
F4 LOW-MED sanitizePath bypasses: query part with no '=' -> '…'; segment ^\+?[\d\s().-]+$ with >=7 digits -> :number;
  segment with '=' -> key=…; '@', '%40' any case, '＠' raw -> email; README "masking is heuristic". Residual: 12-15 char tokens, 6-8 digit codes.
F5 LOW: grouping picks later mark; pick nearest in time within window. Repro: mark A 10000, req 10050, mark B 10250 -> want A.
F6 LOW: read O(marks) per request; binary search marks; add `limit` with seq cursor.
F7 LOW docs: "for each" click (throttle); /api/actions mark can change on later read; query part without = .
Test gaps: piped bytes count; status 0 when client aborts before upstream answers; 9-digit and 8-digit; hex-only, mixed-case-no-digit,
  16-char token; exactly 300 ms edge; seq == after; absolute-form http://u:p@h/a?b=1 -> /a?b=…; server recorder binding (slow req,
  teardown+new ready, release -> not in new log); server honours after; no-store on mark answer; Escape alone posts nothing;
  `at` at start (slow upstream).
