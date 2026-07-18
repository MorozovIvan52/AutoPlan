import fs from "fs";

const path = "src/pages/settings.tsx";
let s = fs.readFileSync(path, "utf8");

if (!s.includes("SalesSettingsSection")) {
  s = s.replace(
    'import { TEMPLATE_CATEGORIES, TEMPLATE_VARS, categoryLabel } from "../lib/templates";',
    'import { TEMPLATE_CATEGORIES, TEMPLATE_VARS, categoryLabel } from "../lib/templates";\nimport { SalesSettingsSection } from "../components/settings/SalesSettingsSection";',
  );

  s = s.replace(
    '"themes" | "tags" | "templates" | "users" | "channels" | "telephony" | "cdek" | "ai"',
    '"themes" | "tags" | "templates" | "users" | "channels" | "telephony" | "cdek" | "ai" | "sales"',
  );

  s = s.replace(
    '(["themes", "tags", "templates", "users", "channels", "telephony", "cdek", "ai"] as const)',
    '(["themes", "tags", "templates", "users", "channels", "telephony", "cdek", "ai", "sales"] as const)',
  );

  s = s.replace(
    'ai: "✨ Алиса / ИИ" }[t]}',
    'ai: "✨ Алиса / ИИ", sales: "🧾 Реализация" }[t]}',
  );

  s = s.replace(
    '{tab === "channels" && (',
    '{tab === "sales" && user?.role === "admin" && (             <>               <SalesSettingsSection />             </>           )}            {tab === "channels" && (',
  );
}

fs.writeFileSync(path, s);
console.log("patched settings");
