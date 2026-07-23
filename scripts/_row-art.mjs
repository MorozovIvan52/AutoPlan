import { readFileSync } from "fs";
import { unzipSync, strFromU8 } from "fflate";

function row(path, rn) {
  const buf = readFileSync(path);
  const files = unzipSync(new Uint8Array(buf));
  const sheet = Object.keys(files).find((k) => /sheet1/i.test(k));
  const xml = strFromU8(files[sheet]);
  const ss = strFromU8(files["xl/sharedStrings.xml"]);
  const strings = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join(""),
  );
  console.log("FILE", path, "row", rn);
  for (const col of ["A", "B", "C", "D", "E", "F"]) {
    const cm = xml.match(new RegExp(`<c r="${col}${rn}"[\\s\\S]*?(?:/>|</c>)`));
    if (!cm) {
      console.log(col + rn, "-");
      continue;
    }
    const c = cm[0];
    if (c.includes('t="s"')) {
      const vi = +c.match(/<v>(\d+)<\/v>/)[1];
      console.log(col + rn, JSON.stringify(strings[vi]));
    } else if (/<v>/.test(c)) console.log(col + rn, c.match(/<v>([^<]*)<\/v>/)[1]);
    else if (c.includes("inlineStr"))
      console.log(col + rn, JSON.stringify(c.match(/<t[^>]*>([^<]*)<\/t>/)?.[1]));
    else console.log(col + rn, c.slice(0, 100));
  }
}

row("C:/Users/1/AppData/Local/Temp/zzap-bot-local/p971.xlsx", "10");
row("C:/Users/1/AppData/Local/Temp/zzap-bot-local/p970.xlsx", "11");
