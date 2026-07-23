import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BUMP_CELL = "G1";
const BUMP_STATE_FILE = join(
  process.env.ZZAP_PRICE_DIR || join(process.cwd(), "data", "zzap-prices"),
  ".bump-state.json",
);
const D_VALUES = new Set(["наличие", "наличие ", "+", "+ "]);
const F_VALUES = new Set(["В наличие", "В наличии", "0", "0 "]);
const HEADERS = ["Производитель", "Номер производителя", "Номенклатура", "Количество", "Цена", "Поставка"];

function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function bumpText() {
  return ` ${Date.now()} `;
}

function colIndex(letters: string) {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

function colLetters(n: number) {
  let s = "";
  let x = n;
  while (x > 0) {
    x--;
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join(""));
  }
  return out;
}

function buildSharedStrings(strings: string[]): string {
  const items = strings.map((s) => {
    const t = escapeXml(s);
    if (/[<>&]/.test(s) || s !== s.trim() || /\s{2,}/.test(s)) {
      return `<si><t xml:space="preserve">${t}</t></si>`;
    }
    return `<si><t>${t}</t></si>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">`
    + items.join("")
    + `</sst>`;
}

function parseRows(xml: string, strings: string[]) {
  const rows: Record<number, Record<number, string>> = {};
  for (const row of xml.match(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g) || []) {
    const rn = parseInt(row.match(/r="(\d+)"/)?.[1] || "0", 10);
    rows[rn] = {};
    for (const c of row.match(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g) || []) {
      const ref = c.match(/r="([A-Z]+\d+)"/)?.[1] || "";
      const col = colIndex(ref.replace(/\d+/, ""));
      let val = "";
      if (c.includes('t="s"')) val = strings[parseInt(c.match(/<v>(\d+)<\/v>/)?.[1] || "-1", 10)] ?? "";
      else if (c.includes('t="inlineStr"')) val = c.match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? "";
      else val = c.match(/<v>([^<]*)<\/v>/)?.[1] || "";
      rows[rn][col] = val;
    }
  }
  return rows;
}

function isNumericPrice(v: string) {
  const n = parseFloat(v.replace(/\s/g, "").replace(",", "."));
  return v.trim() !== "" && !Number.isNaN(n) && n > 0;
}

function normalizeQty(v: string, toggle: boolean): string {
  const t = (v || "").trim();
  if (t === "+" || t === "+ ") return toggle ? "наличие" : "+";
  if (t === "наличие" || t === "наличие ") return toggle ? "+" : "наличие";
  if (t === "В наличии" || t === "В наличие") return "+";
  return t || "+";
}

function normalizeSupply(v: string): string {
  const t = (v || "").trim();
  if (!t || t === "СДЕК ЯНДЕКС" || t.startsWith("СДЕК")) return "0";
  if (t === "В наличии" || t === "В наличие") return "0";
  return t;
}

function buildCell(ref: string, val: string, addStr: (v: string) => number): string {
  const col = ref.replace(/\d+/, "");
  if (col === "E" && isNumericPrice(val)) {
    const num = parseFloat(val.replace(/\s/g, "").replace(",", "."));
    return `<c r="${ref}"><v>${num}</v></c>`;
  }
  const idx = addStr(val);
  return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
}

function buildSheetFromPlainRows(
  dataRows: Array<Record<number, string>>,
  addStr: (v: string) => number,
): string {
  const parts: string[] = [];

  const headerCells = HEADERS.map((h, i) => buildCell(`${colLetters(i + 1)}1`, h, addStr));
  headerCells.push(`<c r="${BUMP_CELL}" t="inlineStr"><is><t>${escapeXml(bumpText())}</t></is></c>`);
  parts.push(`<row r="1">${headerCells.join("")}</row>`);

  dataRows.forEach((r, idx) => {
    const rn = idx + 2;
    const cells: string[] = [];
    for (let col = 1; col <= 6; col++) {
      const val = r[col];
      if (val !== undefined && val !== "") cells.push(buildCell(`${colLetters(col)}${rn}`, val, addStr));
    }
    if (cells.length) parts.push(`<row r="${rn}">${cells.join("")}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${parts.join("")}</sheetData>`
    + `</worksheet>`;
}

function findFirstSheetPath(files: Record<string, Uint8Array>): string | null {
  const paths = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
    .sort((a, b) => parseInt(a.match(/sheet(\d+)/i)?.[1] || "0", 10) - parseInt(b.match(/sheet(\d+)/i)?.[1] || "0", 10));
  return paths[0] ?? null;
}

/** Починить заголовки A–F, F=0, D=+, пересобрать sharedStrings без битых индексов. */
export function repairZzapXlsxBuffer(buffer: Buffer, opts?: { touchRows?: boolean }): Buffer {
  try {
    const files = unzipSync(new Uint8Array(buffer)) as Record<string, Uint8Array>;
    const sheetPath = findFirstSheetPath(files);
    if (!sheetPath || !files["xl/sharedStrings.xml"]) return buffer;

    const oldStrings = parseSharedStrings(strFromU8(files["xl/sharedStrings.xml"]));
    const sheetXml = strFromU8(files[sheetPath]);
    const rows = parseRows(sheetXml, oldStrings);
    const toggle = Date.now() % 2 === 0;

    const dataRows: Array<Record<number, string>> = [];
    const rowNums = Object.keys(rows).map(Number).filter((n) => n > 1).sort((a, b) => a - b);

    for (const rn of rowNums) {
      const r = { ...rows[rn] };
      if (!r[2]?.trim()) continue;

      r[2] = r[2].trim();
      if (r[1]) r[1] = r[1].trim();
      r[4] = normalizeQty(r[4] || "", opts?.touchRows !== false ? toggle : false);
      r[6] = normalizeSupply(r[6] || "");

      if (!isNumericPrice(r[5] || "")) {
        const priceFromName = (r[3] || "").match(/(\d[\d\s]{3,})/);
        if (priceFromName) r[5] = priceFromName[1].replace(/\s/g, "");
        else r[5] = (r[5] || "").trim() || "0";
      }

      dataRows.push(r);
    }

    const strings: string[] = [];
    const addStr = (v: string): number => {
      const i = strings.indexOf(v);
      if (i >= 0) return i;
      strings.push(v);
      return strings.length - 1;
    };

    const newSheet = buildSheetFromPlainRows(dataRows, addStr);
    files["xl/sharedStrings.xml"] = strToU8(buildSharedStrings(strings));
    files[sheetPath] = strToU8(newSheet);
    return Buffer.from(zipSync(files));
  } catch {
    return buffer;
  }
}

function buildSheetPreservingHeader(
  headerRow: Record<number, string>,
  dataRows: Array<Record<number, string>>,
  addStr: (v: string) => number,
): string {
  const parts: string[] = [];
  const headerCells: string[] = [];
  for (let col = 1; col <= 6; col++) {
    const val = headerRow[col];
    if (val !== undefined && val !== "") headerCells.push(buildCell(`${colLetters(col)}1`, val, addStr));
  }
  headerCells.push(`<c r="${BUMP_CELL}" t="inlineStr"><is><t>${escapeXml(bumpText())}</t></is></c>`);
  parts.push(`<row r="1">${headerCells.join("")}</row>`);

  dataRows.forEach((r, idx) => {
    const rn = idx + 2;
    const cells: string[] = [];
    for (let col = 1; col <= 6; col++) {
      const val = r[col];
      if (val !== undefined && val !== "") cells.push(buildCell(`${colLetters(col)}${rn}`, val, addStr));
    }
    if (cells.length) parts.push(`<row r="${rn}">${cells.join("")}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${parts.join("")}</sheetData>`
    + `</worksheet>`;
}

function bumpSheetXml(xml: string): string {
  const newCell = `<c r="${BUMP_CELL}" t="inlineStr"><is><t>${escapeXml(bumpText())}</t></is></c>`;
  const emptyG1 = new RegExp(`<c r="${BUMP_CELL}"[^/]*/>`, "g");
  if (emptyG1.test(xml)) return xml.replace(emptyG1, newCell);
  const cellRe = new RegExp(`<c r="${BUMP_CELL}"[^/]*(?:/>|>[\\s\\S]*?</c>)`, "g");
  if (cellRe.test(xml)) return xml.replace(cellRe, newCell);
  const row1Re = /(<row r="1"[^>]*>)([\s\S]*?)(<\/row>)/;
  if (row1Re.test(xml)) return xml.replace(row1Re, `$1$2${newCell}$3`);
  return xml.replace("</sheetData>", `<row r="1" hidden="1" ht="0">${newCell}</row></sheetData>`);
}

function ensureSharedString(sharedXml: string, value: string): { xml: string; index: number } {
  const strings = parseSharedStrings(sharedXml);
  const existing = strings.indexOf(value);
  if (existing >= 0) return { xml: sharedXml, index: existing };

  const idx = strings.length;
  const t = escapeXml(value);
  const si = /[<>&]/.test(value) || value !== value.trim()
    ? `<si><t xml:space="preserve">${t}</t></si>`
    : `<si><t>${t}</t></si>`;
  const count = idx + 1;
  const xml = sharedXml
    .replace(/count="\d+"/, `count="${count}"`)
    .replace(/uniqueCount="\d+"/, `uniqueCount="${count}"`)
    .replace("</sst>", `${si}</sst>`);
  return { xml, index: idx };
}

type BumpEntry = { seq: number; at: number };

function readBumpState(): Record<string, BumpEntry> {
  try {
    if (!existsSync(BUMP_STATE_FILE)) return {};
    const raw = JSON.parse(readFileSync(BUMP_STATE_FILE, "utf8")) as Record<string, BumpEntry | number>;
    const out: Record<string, BumpEntry> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = typeof v === "number" ? { seq: v, at: 0 } : v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeBumpState(state: Record<string, BumpEntry>) {
  writeFileSync(BUMP_STATE_FILE, JSON.stringify(state));
}

export function resetZzapBumpState(stateKey: string) {
  const state = readBumpState();
  delete state[stateKey];
  writeBumpState(state);
}

const TOUCH_DEBOUNCE_MS = 120_000;

function nextBumpSeq(stateKey: string): number {
  const state = readBumpState();
  const prev = state[stateKey];
  const now = Date.now();
  if (prev && now - prev.at < TOUCH_DEBOUNCE_MS) return prev.seq;
  const seq = (prev?.seq ?? 0) + 1;
  state[stateKey] = { seq, at: now };
  writeBumpState(state);
  return seq;
}

/** Точечный патч A–F: seq++ → D/F по чётности (всегда отличается от прошлого touch). Цены (E) не трогаем. */
export function patchZzapXlsxInPlace(buffer: Buffer, stateKey?: string): Buffer {
  try {
    const files = unzipSync(new Uint8Array(buffer)) as Record<string, Uint8Array>;
    const sheetPath = findFirstSheetPath(files);
    if (!sheetPath || !files["xl/sharedStrings.xml"]) return bumpZzapXlsxBuffer(buffer);

    const seq = nextBumpSeq(stateKey || "default");
    const dTarget = seq % 2 === 1 ? "+" : "наличие";
    const fTarget = seq % 2 === 1 ? "В наличии" : "В наличие";

    let sharedXml = strFromU8(files["xl/sharedStrings.xml"]);
    let sheetXml = strFromU8(files[sheetPath]);
    const strings = parseSharedStrings(sharedXml);

    let idxD = strings.indexOf(dTarget);
    if (idxD < 0) {
      const r = ensureSharedString(sharedXml, dTarget);
      sharedXml = r.xml;
      idxD = r.index;
      strings.push(dTarget);
    }
    let idxF = strings.indexOf(fTarget);
    if (idxF < 0) {
      const r = ensureSharedString(sharedXml, fTarget);
      sharedXml = r.xml;
      idxF = r.index;
      strings.push(fTarget);
    }

    // Убрать мусорные пробелы в F2 от старого bump — иначе ZZap/патч их не видит
    sheetXml = sheetXml.replace(
      /<c r="F2" t="inlineStr"><is><t[^>]*>\s*<\/t><\/is><\/c>/g,
      "",
    );
    sheetXml = sheetXml.replace(
      /<c r="G2"[^/]*(?:\/>|>[\s\S]*?<\/c>)/g,
      "",
    );

    sheetXml = sheetXml.replace(
      /<c r="D(\d+)"([^>]*?)t="s"([^>]*?)><v>(\d+)<\/v><\/c>/g,
      (m, row, a1, a2, vi) => {
        if (Number(row) < 2) return m;
        const val = strings[Number(vi)] ?? "";
        if (!D_VALUES.has(val.trim()) && !D_VALUES.has(val)) return m;
        return `<c r="D${row}"${a1}t="s"${a2}><v>${idxD}</v></c>`;
      },
    );

    sheetXml = sheetXml.replace(
      /<c r="F(\d+)"([^>]*?)t="s"([^>]*?)><v>(\d+)<\/v><\/c>/g,
      (m, row, a1, a2, vi) => {
        if (Number(row) < 2) return m;
        const val = strings[Number(vi)] ?? "";
        if (!F_VALUES.has(val.trim()) && !F_VALUES.has(val)) return m;
        return `<c r="F${row}"${a1}t="s"${a2}><v>${idxF}</v></c>`;
      },
    );

    sheetXml = bumpSheetXml(sheetXml);
    files["xl/sharedStrings.xml"] = strToU8(sharedXml);
    files[sheetPath] = strToU8(sheetXml);
    return Buffer.from(zipSync(files));
  } catch {
    return bumpZzapXlsxBuffer(buffer);
  }
}

/** @deprecated полная пересборка ломает формат ZZap — используйте patchZzapXlsxInPlace */
export function refreshZzapXlsxBuffer(buffer: Buffer, _opts?: { markSale?: boolean }): Buffer {
  return patchZzapXlsxInPlace(buffer);
}

/** @deprecated use refreshZzapXlsxBuffer */
export function prepareZzapSaleDownloadBuffer(buffer: Buffer): Buffer {
  return refreshZzapXlsxBuffer(buffer, { markSale: true });
}

export function isZzapSaleRazdatkiFile(fileName?: string | null): boolean {
  const n = (fileName || "").toLowerCase();
  return (n.includes("продажа") || n.includes("prodazha")) && (n.includes("раздат") || n.includes("razdat"));
}

/** @deprecated */
export function normalizeZzapSaleXlsx(buffer: Buffer): Buffer {
  return repairZzapXlsxBuffer(buffer, { touchRows: false });
}

export function bumpZzapXlsxBuffer(buffer: Buffer): Buffer {
  try {
    const files = unzipSync(new Uint8Array(buffer)) as Record<string, Uint8Array>;
    const sheetPath = findFirstSheetPath(files);
    if (!sheetPath) return buffer;

    let sheetXml = strFromU8(files[sheetPath]);
    if (!sheetXml.includes("<sheetData")) return buffer;

    files[sheetPath] = strToU8(bumpSheetXml(sheetXml));
    return Buffer.from(zipSync(files));
  } catch {
    return buffer;
  }
}

/**
 * Реальное изменение контента для ZZap: D/F toggle (наличие/+).
 * Пробелы в пустых ячейках ZZap отбрасывает → «без изменений».
 */
export function putSpaceInEmptyCell(buffer: Buffer, stateKey?: string): Buffer {
  return patchZzapXlsxInPlace(buffer, stateKey);
}

/** @deprecated используйте putSpaceInEmptyCell */
export function forceZzapContentChange(buffer: Buffer, stateKey?: string): Buffer {
  return putSpaceInEmptyCell(buffer, stateKey);
}

export function isZzapBumpableFile(fileName?: string | null): boolean {
  const ext = (fileName || "").toLowerCase();
  return ext.endsWith(".xlsx") || ext.endsWith(".xltx");
}

/** Файлы не меняем — отдаём как загружены. */
export function prepareZzapSeedFile(buffer: Buffer): Buffer {
  return buffer;
}

export function isZzapSaleFile(fileName?: string | null): boolean {
  const n = (fileName || "").toLowerCase();
  return n.includes("продажа");
}
