#!/usr/bin/env python3
"""Force-hide version mismatch banner and align build ids on VPS."""
from pathlib import Path
import re, json

dist = Path("/opt/crm/dist")
html_path = dist / "index.html"
html = html_path.read_text(encoding="utf-8")

# Align json to meta
meta = re.search(r'crm-build-id"\s+content="([^"]+)"', html)
if meta:
    (dist / "crm-build-id.json").write_text(
        json.dumps({"id": meta.group(1)}, separators=(",", ":")), encoding="utf-8"
    )
    print("aligned json to", meta.group(1))

# Inject CSS+JS kill-switch once
MARKER = "<!-- crm-version-banner-killswitch -->"
if MARKER not in html:
    inject = f"""
{MARKER}
<style>
  [data-testid="version-mismatch-banner"],
  .crm-version-banner {{
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
    height: 0 !important;
    overflow: hidden !important;
  }}
</style>
<script>
(function () {{
  function kill() {{
    document.querySelectorAll('[data-testid="version-mismatch-banner"], .crm-version-banner').forEach(function (el) {{
      el.remove();
    }});
  }}
  kill();
  setInterval(kill, 400);
  document.addEventListener("DOMContentLoaded", kill);
}})();
</script>
"""
    if "</head>" in html:
        html = html.replace("</head>", inject + "\n</head>", 1)
    else:
        html = inject + html
    html_path.write_text(html, encoding="utf-8")
    print("injected killswitch into index.html")
else:
    print("killswitch already present")

print("done")
