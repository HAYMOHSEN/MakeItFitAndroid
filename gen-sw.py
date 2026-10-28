# Generates sw.js with the full list of app files (run after adding or renaming files).
import os, json, hashlib
root = os.path.dirname(os.path.abspath(__file__))
skip_dirs = {'.git', 'store', 'tests'}
skip_files = {'gen-sw.py', 'sw.js', 'sw.template.js', 'README.md', '.nojekyll'}
assets = ['./']
for d, dirs, files in os.walk(root):
    dirs[:] = sorted(x for x in dirs if x not in skip_dirs and not x.startswith('.'))
    for f in sorted(files):
        if f in skip_files or f.startswith('.') or f.endswith(('.md', '.LICENSE.md')) or f.startswith('LICENSE'):
            continue
        rel = os.path.relpath(os.path.join(d, f), root).replace(os.sep, '/')
        assets.append('./' + rel)
version = open(os.path.join(root, 'app.js')).read().split("const VERSION = '")[1].split("'")[0]
# The cache name includes a hash of every file, so any change makes phones download the update.
h = hashlib.sha256()
for a in assets[1:]:
    with open(os.path.join(root, a[2:]), 'rb') as f:
        h.update(a.encode()); h.update(f.read())
version = f"{version}-{h.hexdigest()[:10]}"
tpl = open(os.path.join(root, 'sw.template.js')).read()
out = tpl.replace('__VERSION__', version).replace('__ASSETS__', json.dumps(assets))
open(os.path.join(root, 'sw.js'), 'w').write(out)
print(len(assets), 'files, version', version)
