import fs from "fs";
const s = fs.readFileSync("src/pages/settings.tsx", "utf8");
const pos = 47091;
console.log(s.slice(pos - 80, pos + 120));
