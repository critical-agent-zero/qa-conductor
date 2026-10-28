import json
d=json.load(open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/findings.json'))
for k in ['confirmed','refuted','minor']:
  print('########', k)
  for f in d.get(k,[]):
    if isinstance(f, dict):
      for kk,vv in f.items():
        print(kk.upper()+':', vv)
      print('-----')
    else:
      print(f)
