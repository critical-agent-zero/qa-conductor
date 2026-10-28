import sys
# usage: append.py <target> <chunk>: appends the chunk file to the target file
target, chunk = sys.argv[1], sys.argv[2]
with open(target, 'a') as f:
    f.write(open(chunk).read())
print('appended', chunk, 'to', target)
