import fs from "fs";

const path = "src/pages/settings.tsx";
let s = fs.readFileSync(path, "utf8");

if (!s.includes('"sales"') || !s.includes("SalesSettingsSection")) {
  console.log("missing patches");
}

if (!s.includes('sales:')) {
  s = s.replace(
    /ai: "[^"]+" \}\[t\]\}/,
    (m) => m.replace("}[t]}", ', sales: "🧾 Реализация" }[t]}'),
  );
  fs.writeFileSync(path, s);
  console.log("added sales nav label");
} else {
  console.log("sales nav already present");
}
