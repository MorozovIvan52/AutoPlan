import { readFileSync } from "fs";
import { unzipSync, strFromU8 } from "fflate";

const path = process.argv[2];
const buf = readFileSync(path);
const f = unzipSync(new Uint8Array(buf));
const xml = strFromU8(f[Object.keys(f).find((k) => /sheet1/i.test(k))]);
const ss = strFromU8(f["xl/sharedStrings.xml"]);
const strings = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
  [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join(""),
);
for (const ref of ["D2", "D10", "F2", "F3", "B10", "E10"]) {
  const m = xml.match(new RegExp(`<c r="${ref}"[\\s\\S]*?(?:/>|</c>)`));
  if (!m) {
    console.log(ref, "-");
    continue;
  }
  const c = m[0];
  if (c.includes('t="s"')) {
    const vi = +c.match(/<v>(\d+)<\/v>/)[1];
    console.log(ref, JSON.stringify(strings[vi]));
  } else if (/<v>/.test(c)) console.log(ref, c.match(/<v>([^<]*)<\/v>/)[1]);
  else console.log(ref, c.slice(0, 100));
}
