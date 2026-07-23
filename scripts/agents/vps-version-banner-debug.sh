#!/bin/bash
cd /opt/crm
echo "=== files ==="
ls -la dist/index.html dist/crm-build-id.json 2>&1
echo "=== meta ==="
python3 - <<'PY'
from pathlib import Path
import re, json
html = Path('dist/index.html').read_text(encoding='utf-8', errors='replace')
m = re.search(r'crm-build-id"\s+content="([^"]+)"', html)
print('meta=', m.group(1) if m else None)
j = json.loads(Path('dist/crm-build-id.json').read_text())
print('json=', j)
# search assets for banner phrases (utf-8 and escaped)
needles = [
  'Обновить сейчас',
  'устаревшая версия',
  'Обновляем интерфейс',
  'version_mismatch',
  'crm-build-id',
  '__CRM_BUILD_ID__',
  'location.reload',
]
assets = list(Path('dist/assets').glob('*.js'))
for n in needles:
  hits = []
  for p in assets:
    try:
      t = p.read_text(encoding='utf-8', errors='ignore')
    except Exception:
      continue
    if n in t:
      hits.append(p.name)
  print(f'needle {n!r}: {len(hits)} files', hits[:5])

# find possible unicode escapes
import codecs
for p in assets:
  t = p.read_text(encoding='utf-8', errors='ignore')
  if 'crm-build-id' in t or '__CRM_BUILD_ID__' in t or 'version_mismatch' in t:
    print('CAND', p.name, 'size', p.stat().st_size)
    for pat in ['crm-build-id', '__CRM_BUILD_ID__', 'version_mismatch', 'reload']:
      i = t.find(pat)
      if i >= 0:
        print(' ', pat, '->', repr(t[max(0,i-40):i+80]))
PY

echo "=== health with host ==="
curl -sS -H 'Host: sto1.crmavito.online' http://127.0.0.1:4200/api/health
echo
curl -sS -H 'Host: sto1.crmavito.online' http://127.0.0.1:4200/crm-build-id.json
echo
