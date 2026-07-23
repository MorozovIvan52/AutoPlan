import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { unzipSync, strFromU8 } from "fflate";

const ART = "4780024700";
const dirs = [
  "C:/Users/1/Desktop/autoplan/data/zzap-seed",
  "C:/Users/1/AppData/Local/Temp/zzap-bot-local",
];

function hasArt(path) {
  try {
    const buf = readFileSync(path);
    const files = unzipSync(new Uint8Array(buf));
    const blob = Object.values(files)
      .map((u) => strFromU8(u))
      .join("\n");
    // also raw
    if (buf.includes(ART) || blob.includes(ART)) return true;
    return false;
  } catch {
    return false;
  }
}

for (const dir of dirs) {
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => /\.xlsx$/i.test(n));
  } catch {
    continue;
  }
  for (const n of names) {
    const p = join(dir, n);
    console.log(hasArt(p) ? "YES" : "no ", p);
  }
}
