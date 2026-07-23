const fs = require("fs");
const t = fs.readFileSync(".env", "utf8");
const m = t.match(/^CURSOR_API_KEY=(.*)$/m);
if (!m) {
  console.log("NO_LINE");
  process.exit(1);
}
let v = String(m[1]).trim();
if (
  (v.startsWith('"') && v.endsWith('"')) ||
  (v.startsWith("'") && v.endsWith("'"))
) {
  v = v.slice(1, -1);
}
if (!v) {
  console.log("EMPTY");
  process.exit(2);
}
console.log("OK len=" + v.length + " prefix=" + v.slice(0, 6));
