import { readFileSync } from "fs";
import { unzipSync, strFromU8 } from "fflate";

function dump(path) {
  const buf = readFileSync(path);
  const files = unzipSync(new Uint8Array(buf));
  const sheetPath =
    Object.keys(files).find((k) => /sheet1\.xml$/i.test(k)) ||
    Object.keys(files).find((k) => /worksheets\/sheet/i.test(k));
  const xml = strFromU8(files[sheetPath]);
  const ss = files["xl/sharedStrings.xml"]
    ? strFromU8(files["xl/sharedStrings.xml"])
    : "";
  const strings = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join(""),
  );
  console.log("\n==", path, buf.length);
  for (const ref of ["A2", "B2", "C2", "D2", "E2", "F2", "B3", "D3", "E3", "F3"]) {
    const m = xml.match(new RegExp(`<c r="${ref}"[\\s\\S]*?(?:/>|</c>)`));
    console.log(ref, m ? m[0].slice(0, 180) : "-");
  }
  console.log("ss0-15", JSON.stringify(strings.slice(0, 15)));
  const artIdx = strings.findIndex((s) => s.includes("4780024700"));
  console.log("artIdx", artIdx, artIdx >= 0 ? strings[artIdx] : null);
  if (artIdx >= 0) {
    const re = new RegExp(`<c r="B(\\d+)"[^>]*t="s"[^>]*><v>${artIdx}</v></c>`);
    const rm = xml.match(re);
    console.log("artRow", rm && rm[1]);
    if (rm) {
      const row = rm[1];
      for (const col of ["A", "B", "C", "D", "E", "F"]) {
        const cm = xml.match(
          new RegExp(`<c r="${col}${row}"[\\s\\S]*?(?:/>|</c>)`),
        );
        if (!cm) {
          console.log(" ", col + row, "-");
          continue;
        }
        if (cm[0].includes('t="s"')) {
          const vi = Number(cm[0].match(/<v>(\d+)<\/v>/)?.[1]);
          console.log(" ", col + row, JSON.stringify(strings[vi]));
        } else if (/<v>/.test(cm[0])) {
          console.log(" ", col + row, cm[0].match(/<v>([^<]*)<\/v>/)?.[1]);
        } else {
          console.log(" ", col + row, cm[0].slice(0, 120));
        }
      }
    }
  }
}

const dir = "C:/Users/1/AppData/Local/Temp/zzap-bot-local";
for (const f of ["p971.xlsx", "p970.xlsx", "p269.xlsx", "p467.xlsx"]) {
  dump(`${dir}/${f}`);
}
