import fs from "fs";
const s = fs.readFileSync("src/pages/settings.tsx", "utf8");
const idx = s.indexOf("sales:");
console.log(s.slice(idx - 200, idx + 120));
