from pathlib import Path

client = Path(r"C:\Users\1\Desktop\autoplan\_restore_from_client\settings.tsx").read_text(encoding="utf-8")
cur = Path(r"C:\Users\1\Desktop\autoplan\src\pages\settings.tsx").read_text(encoding="utf-8")

print("client head:")
print("\n".join(client.splitlines()[:30]))
print("---")
print("Sales in client", "SalesSettings" in client)
print("NotificationSettings in imports", "NotificationSettings" in client.split("export default")[0])
needle = '{tab === "general"'
idx = client.find(needle)
print("general jsx idx", idx)
print(repr(client[idx : idx + 120]))

# Build merged settings: client base + sales tab from current
sales_import = 'import { SalesSettingsSection } from "../components/settings/SalesSettingsSection";\n'
notif_ok = 'import { NotificationSettings } from "../components/NotificationSettings";' in client

merged = client
if "SalesSettingsSection" not in merged:
    # add import after AppShell import
    merged = merged.replace(
        'import { AppShell } from "../components/AppShell";',
        'import { AppShell } from "../components/AppShell";\n' + sales_import.strip(),
    )

# extend tab union type
old_type = 'useState<"themes" | "security" | "alerts" | "tags" | "templates" | "users" | "channels" | "general" | "telephony" | "cdek" | "ai">("themes")'
new_type = 'useState<"themes" | "security" | "alerts" | "tags" | "templates" | "users" | "channels" | "general" | "telephony" | "cdek" | "ai" | "sales">("themes")'
if old_type not in merged:
    raise SystemExit("tab type not found")
merged = merged.replace(old_type, new_type, 1)

old_tabs = 'const ALL_TABS = ["themes", "security", "alerts", "tags", "templates", "users", "channels", "general", "telephony", "cdek", "ai"] as const;'
new_tabs = 'const ALL_TABS = ["themes", "security", "alerts", "tags", "templates", "users", "channels", "general", "telephony", "cdek", "ai", "sales"] as const;'
if old_tabs not in merged:
    raise SystemExit("ALL_TABS not found")
merged = merged.replace(old_tabs, new_tabs, 1)

# labels map
if 'sales:' not in merged:
    merged = merged.replace(
        'ai: "✨ Алиса / ИИ",\n  };',
        'ai: "✨ Алиса / ИИ",\n    sales: "🧾 Реализация",\n  };',
        1,
    )

# insert sales panel before closing of content area - after ai tab block end is hard;
# append before last few closings: find `{tab === "ai"` block end, or after last tab panel
if 'tab === "sales"' not in merged:
    sales_block = '''
          {tab === "sales" && user?.role === "admin" && (
            <SalesSettingsSection />
          )}
'''
    # insert before final closing divs of page content - after cdek/ai sections
    # Prefer insert right before the closing of the scrollable content wrapper that follows tabs
    marker = "        </div>\n      </div>\n    </AppShell>"
    if marker not in merged:
        # try alternate
        marker = "        </div>\n      </div>\n    </AppShell>\n  );"
    if marker not in merged:
        raise SystemExit("end marker not found")
    merged = merged.replace(marker, sales_block + "\n" + marker, 1)

out = Path(r"C:\Users\1\Desktop\autoplan\src\pages\settings.tsx")
out.write_text(merged, encoding="utf-8", newline="\n")
print("wrote settings", len(merged))
print("has sales tab", 'tab === "sales"' in merged)
print("has security", 'tab === "security"' in merged)
print("has general", 'tab === "general"' in merged)
print("has alerts", 'tab === "alerts"' in merged)
print("has SalesSettings", "SalesSettingsSection" in merged)
