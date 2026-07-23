#!/usr/bin/env python3
"""Align crm-build-id meta/json to JS bundle id; optional banner killswitch."""
from pathlib import Path
import re
import json
import sys

dist = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/crm/dist")
html_path = dist / "index.html"
html = html_path.read_text(encoding="utf-8")
m_script = re.search(r'src="(/assets/[^"]+\.js)"', html)
if not m_script:
    raise SystemExit("no assets script in index.html")
script = m_script.group(1)
js = (dist / script.lstrip("/")).read_text(encoding="utf-8", errors="ignore")

bundle_id = None
for pat in (
    r'function th\(\)\{return"([^"]+)"\}',
    r'__CRM_BUILD_ID__\s*=\s*"([^"]+)"',
    r'getBundleBuildId\(\)\{[^}]*return"([^"]+)"',
    r'try\{if\(typeof \w+=="string"&&\w+\)return \w+\}catch\{\}return null\}[^"]*"([^"]+)"',
):
    m = re.search(pat, js)
    if m:
        bundle_id = m.group(1)
        break

# Fallback: trust meta if present and also in JS
if not bundle_id:
    meta_m = re.search(r'crm-build-id" content="([^"]+)"', html)
    if meta_m and meta_m.group(1) in js:
        bundle_id = meta_m.group(1)

print("script", script)
print("bundle_id", bundle_id)

meta = re.search(r'crm-build-id" content="([^"]+)"', html)
print("meta_before", meta.group(1) if meta else None)
json_path = dist / "crm-build-id.json"
print("json_before", json_path.read_text(encoding="utf-8") if json_path.exists() else None)

kill = """
<!--crm-banner-killswitch-->
<script>
(function(){
  function hide(){
    document.querySelectorAll('[data-testid="version-mismatch-banner"]').forEach(function(el){ el.remove(); });
  }
  hide();
  try {
    new MutationObserver(hide).observe(document.documentElement,{childList:true,subtree:true});
  } catch (e) {}
})();
</script>
"""
if "crm-banner-killswitch" not in html:
    if "</body>" in html:
        html = html.replace("</body>", kill + "</body>", 1)
        print("killswitch_injected")
    else:
        html = html + kill
        print("killswitch_appended")

if bundle_id:
    html2, n = re.subn(
        r'(<meta name="crm-build-id" content=")[^"]+("\s*/?>)',
        rf"\g<1>{bundle_id}\2",
        html,
        count=1,
    )
    if n == 0:
        html2 = html.replace(
            "</head>",
            f'    <meta name="crm-build-id" content="{bundle_id}" />\n  </head>',
            1,
        )
    json_path.write_text(json.dumps({"id": bundle_id}, separators=(",", ":")), encoding="utf-8")
    html_path.write_text(html2, encoding="utf-8")
    print("aligned", bundle_id)
else:
    html_path.write_text(html, encoding="utf-8")
    print("WARN: no bundle id found; only killswitch applied")

html_after = html_path.read_text(encoding="utf-8")
meta_after = re.search(r'crm-build-id" content="([^"]+)"', html_after)
print("meta_after", meta_after.group(1) if meta_after else None)
print("json_after", json_path.read_text(encoding="utf-8") if json_path.exists() else None)
print("has_killswitch", "crm-banner-killswitch" in html_after)
