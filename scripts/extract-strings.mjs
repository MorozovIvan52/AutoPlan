import fs from "fs";
const file = process.argv[2];
const s = fs.readFileSync(file, "utf8");
const m = [...s.matchAll(/"([^"\\]{3,120})"/g)].map((x) => x[1]);
const filtered = [...new Set(m)].filter(
  (t) => /[\u0400-\u04FF]/.test(t) || /sales|receipt|invoice|warranty|article/i.test(t),
);
console.log(filtered.join("\n"));
