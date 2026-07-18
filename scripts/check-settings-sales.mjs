import fs from "fs";
const s = fs.readFileSync("src/pages/settings.tsx", "utf8");
const idx = s.indexOf('tab === "sales"');
console.log("idx", idx);
console.log(s.slice(idx - 50, idx + 250));
const idx2 = s.indexOf('tab === "channels"');
console.log("channels idx", idx2);
console.log(s.slice(idx2 - 100, idx2 + 80));
