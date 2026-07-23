#!/usr/bin/env python3
from pathlib import Path
import re
t = Path("/opt/crm/dist/assets/index-DknPjeZ8.js").read_text(encoding="utf-8", errors="ignore")
# find function th
for m in re.finditer(r"function th\([^)]*\)\{[^}]{0,300}\}", t):
    print(m.group(0))
# also L1
for m in re.finditer(r"function L1\([^)]*\)\{[^}]{0,300}\}", t):
    print("L1", m.group(0))
# search th= or const th
idx = t.find("function th(")
print("idx th", idx, repr(t[idx:idx+200]))
# maybe th is assigned differently - look for BUILD
for pat in ["__CRM_BUILD", "buildId=", "CRM_BUILD"]:
    print(pat, t.find(pat))
# find definition of th used as th() in Q1 - search backwards for th=
# In minified code th might be: function th(){return"xxx"}
m = re.search(r"function th\(\)\{return\"([^\"]+)\"\}", t)
print("th return", m.group(1) if m else None)
m = re.search(r"function th\(\)\{return'([^']+)'\}", t)
print("th return2", m.group(1) if m else None)
# broader
m = re.search(r"function th\(\)\{.{0,80}\}", t)
print("th broad", m.group(0) if m else None)
