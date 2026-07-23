#!/bin/bash
cd /opt/crm
python3 - <<'PY'
from pathlib import Path
import re, json
html = Path('dist/index.html').read_text(encoding='utf-8')
print(html)
scripts = re.findall(r'src="(/assets/[^"]+)"', html)
print('SCRIPTS', scripts)
# sync ids
meta = re.search(r'crm-build-id"\s+content="([^"]+)"', html)
print('meta before', meta.group(1) if meta else None)
jpath = Path('dist/crm-build-id.json')
j = json.loads(jpath.read_text())
print('json before', j)
# Prefer the meta currently in HTML if it's intentional menu-restore,
# but BOTH must match. Use menu-restore id as canonical so currently open
# pages that already have that meta stop complaining after json sync.
# Actually: open tabs have meta menu-restore; json is different so fetch
# of /crm-build-id.json or /api/health fails comparison.
# Fix: write json = meta content.
canonical = meta.group(1) if meta else j.get('id')
jpath.write_text(json.dumps({"id": canonical}, separators=(',',':')), encoding='utf-8')
print('json after', jpath.read_text())
# Also ensure only one meta
print('meta count', len(re.findall('crm-build-id', html)))
PY

# restart not needed for static files
echo "=== verify ==="
curl -sS -H 'Host: sto1.crmavito.online' http://127.0.0.1:4200/crm-build-id.json
echo
grep -o 'crm-build-id" content="[^"]*"' dist/index.html
