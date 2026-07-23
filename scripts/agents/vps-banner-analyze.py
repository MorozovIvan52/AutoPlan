#!/usr/bin/env python3
from pathlib import Path
import re, json

root = Path("/opt/crm/dist")
html = (root / "index.html").read_text(encoding="utf-8")
meta_m = re.search(r'crm-build-id"\s+content="([^"]+)"', html)
script_m = re.search(r'src="(/assets/[^"]+)"', html)
meta = meta_m.group(1) if meta_m else None
script = script_m.group(1) if script_m else None
print("meta", meta)
print("script", script)
print("json", (root / "crm-build-id.json").read_text(encoding="utf-8"))

js_path = root / script.lstrip("/")
t = js_path.read_text(encoding="utf-8", errors="ignore")

# find compare logic around crm-build-id
idx = t.find('crm-build-id')
print("first crm-build-id context:\n", repr(t[idx:idx+800]))

# find Obnovit button handler
idx2 = t.find("Обновить сейчас")
print("\nbutton context:\n", repr(t[max(0,idx2-300):idx2+400]))

# find likely baked build ids (menu-restore or mrub)
for pat in ["menu-restore-", "mrub8gdf", "crm-build-id.json", "/api/health"]:
    print(pat, t.count(pat))

# Heuristic: strings looking like build ids near version_mismatch
for m in re.finditer(r'version_mismatch.{0,200}', t):
    print("vm", m.group(0)[:200])
    break
