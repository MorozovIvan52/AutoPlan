from pathlib import Path
import re

client = Path(r"C:\Users\1\Desktop\autoplan\_restore_from_client\settings.tsx").read_text(encoding="utf-8")
cur_path = Path(r"C:\Users\1\Desktop\autoplan\src\pages\settings.tsx")
cur = cur_path.read_text(encoding="utf-8")

# Extract security block from client (from {tab === "security" to before next tab or themes end)
sec_m = re.search(
    r'(\{tab === "security" && \([\s\S]*?\{/\* Tags \*/\}|\{tab === "security" && \([\s\S]*?\n          \{tab === ")',
    client,
)
# more reliable: line-based extraction
lines = client.splitlines(True)
def extract_tab(tab_id: str) -> str:
    start = None
    chunks = []
    for i, line in enumerate(lines):
        if f'tab === "{tab_id}"' in line:
            start = i
            chunks = [line]
            continue
        if start is not None:
            # next top-level tab === at same indent
            if re.match(r'\s{10}\{tab === "', line) or re.match(r'\s{10}\{tab === "', line.replace("\t"," ")):
                break
            if line.startswith("          {tab === ") and f'"{tab_id}"' not in line:
                break
            chunks.append(line)
    return "".join(chunks)

security = extract_tab("security")
alerts = extract_tab("alerts")
general = extract_tab("general")
print("security len", len(security), "alerts", len(alerts), "general", len(general))
Path(r"C:\Users\1\Desktop\autoplan\_restore_from_client\_sec.txt").write_text(security, encoding="utf-8")
Path(r"C:\Users\1\Desktop\autoplan\_restore_from_client\_alerts.txt").write_text(alerts, encoding="utf-8")
Path(r"C:\Users\1\Desktop\autoplan\_restore_from_client\_general.txt").write_text(general, encoding="utf-8")
# also extract general-related state/queries from client for merge hints
for pat in ["crm/settings", "crm-settings", "pwMinLength", "NotificationSettings", "companyName", "cpa"]:
    print(pat, pat in client, pat in cur)
