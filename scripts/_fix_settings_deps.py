from pathlib import Path
import re

auto = Path(r"C:\Users\1\Desktop\autoplan")
client_root = next(
    p
    for p in Path(r"C:\Users\1\Desktop").iterdir()
    if p.is_dir()
    and p.resolve() != auto.resolve()
    and (p / "src/pages/zzap.tsx").exists()
    and (p / "src/pages/zzap.tsx").stat().st_size > 10000
)

# libs needed if we keep richer templates later
(auto / "src/lib/template-media.ts").write_text(
    (client_root / "src/lib/template-media.ts").read_text(encoding="utf-8"),
    encoding="utf-8",
    newline="\n",
)

client_upload = (client_root / "src/lib/upload.ts").read_text(encoding="utf-8")
cur_upload = (auto / "src/lib/upload.ts").read_text(encoding="utf-8")
if "uploadMediaFile" not in cur_upload:
    # Prefer client upload (has media) but keep uploadImageFile alias if missing
    text = client_upload
    if "uploadImageFile" not in text:
        text += """

export async function uploadImageFile(file: File): Promise<string> {
  const media = await uploadMediaFile(file);
  return typeof media === "string" ? media : media.url;
}
"""
    (auto / "src/lib/upload.ts").write_text(text, encoding="utf-8", newline="\n")
    print("upload.ts replaced from client")
else:
    print("upload already has uploadMediaFile")

# verify settings UTF-8 themes label
settings = (auto / "src/pages/settings.tsx").read_text(encoding="utf-8")
print("settings has Тёмно", "Тёмно" in settings or "Темно" in settings)
print("settings size", len(settings.encode("utf-8")))
print("SalesSettings import", "SalesSettingsSection" in settings)
# ensure SalesSettings import line exists
if "SalesSettingsSection" in settings and 'from "../components/settings/SalesSettingsSection"' not in settings:
    settings = settings.replace(
        'import { AppShell } from "../components/AppShell";',
        'import { AppShell } from "../components/AppShell";\nimport { SalesSettingsSection } from "../components/settings/SalesSettingsSection";',
        1,
    )
    (auto / "src/pages/settings.tsx").write_text(settings, encoding="utf-8", newline="\n")
    print("fixed SalesSettings import")

print("template-media copied")
print("client_root", client_root)
