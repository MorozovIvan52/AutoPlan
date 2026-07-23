from pathlib import Path
import tarfile
import io

root = Path(r"C:\Users\1\Desktop\autoplan")
# verify utf8 in settings
s = (root / "src/pages/settings.tsx").read_bytes()
print("settings has themes utf8", "Темы".encode("utf-8") in s)
print("settings has security", b"security" in s)
print("nav delivery", b"/delivery" in (root / "src/lib/nav.ts").read_bytes())

files = [
    "src/app.tsx",
    "src/lib/nav.ts",
    "src/lib/upload.ts",
    "src/lib/template-media.ts",
    "src/lib/notification-alerts.ts",
    "src/pages/settings.tsx",
    "src/pages/delivery.tsx",
    "src/pages/zzap.tsx",
    "src/pages/buyouts.tsx",
    "src/pages/assistant.tsx",
]

out = root / "_restore_nav_bundle.tar.gz"
with tarfile.open(out, "w:gz") as tar:
    for rel in files:
        p = root / rel
        if not p.exists():
            raise SystemExit(f"missing {rel}")
        tar.add(p, arcname=rel)
        print("add", rel, p.stat().st_size)

print("bundle", out, out.stat().st_size)
