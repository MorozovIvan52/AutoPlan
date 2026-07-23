from pathlib import Path
import shutil

root = next(
    p
    for p in Path(r"C:\Users\1\Desktop").iterdir()
    if p.is_dir()
    and (p / "src/pages/zzap.tsx").exists()
    and (p / "src/pages/zzap.tsx").stat().st_size > 1000
)

dest_pages = Path(r"C:\Users\1\Desktop\autoplan\src\pages")
for name in ["delivery.tsx", "zzap.tsx", "buyouts.tsx", "assistant.tsx"]:
    src = root / "src/pages" / name
    text = src.read_text(encoding="utf-8")
    # normalize excessive blank lines from some exports
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    (dest_pages / name).write_text(text, encoding="utf-8", newline="\n")
    print("copied", name, len(text))

# also keep a clean settings source for merge
shutil.copy2(root / "src/pages/settings.tsx", Path(r"C:\Users\1\Desktop\autoplan\_restore_from_client\settings.tsx"))
print("client settings refreshed", (root / "src/pages/settings.tsx").stat().st_size)
print("ROOT", root)
