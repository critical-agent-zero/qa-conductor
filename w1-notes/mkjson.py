import json
import sys
# usage: mkjson.py <md file> <json out> [old=new ...]: the md as {"body": ...}, with replacements
src, out = sys.argv[1], sys.argv[2]
s = open(src).read()
for pair in sys.argv[3:]:
    old, new = pair.split('=>', 1)
    assert s.count(old) == 1, (old, s.count(old))
    s = s.replace(old, new)
open(src, 'w').write(s)
json.dump({'body': s}, open(out, 'w'))
print(len(s))
