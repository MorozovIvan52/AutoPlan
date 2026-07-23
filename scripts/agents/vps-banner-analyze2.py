#!/usr/bin/env python3
from pathlib import Path
import re

t = Path("/opt/crm/dist/assets/index-DknPjeZ8.js").read_text(encoding="utf-8", errors="ignore")

# Find X1 definition (reload)
for m in re.finditer(r"function X1\([^)]*\)\{[^}]{0,400}\}", t):
    print("X1", m.group(0)[:500])
    print("---")

# Find version-mismatch-banner usage and surrounding component
idx = t.find("version-mismatch-banner")
print("banner idx", idx)
print(repr(t[max(0,idx-1500):idx+800]))

# Find crm-build-id.json fetch
idx = t.find("crm-build-id.json")
print("\njson fetch", repr(t[max(0,idx-200):idx+350]))

idx = t.find("/api/health")
# only near version
for m in re.finditer(r"/api/health.{0,120}", t):
    s = m.group(0)
    if "build" in t[m.start()-80:m.end()+80] or "version" in t[m.start()-80:m.end()+80]:
        print("health ctx", repr(t[m.start()-100:m.end()+150]))
