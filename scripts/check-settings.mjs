import fs from "fs";

const path = "src/pages/settings.tsx";
const s = fs.readFileSync(path, "utf8");
let open = 0;
for (const ch of s) {
  if (ch === "{") open++;
  if (ch === "}") open--;
}
console.log("brace balance:", open);
console.log("length:", s.length);
console.log("tail:", s.slice(-200));
