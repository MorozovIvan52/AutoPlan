import { stream } from "hono/streaming";
import type { Context } from "hono";

export function csvBool(value: unknown): string {
  if (value === true || value === 1 || value === "1") return "Да";
  if (value === false || value === 0 || value === "0") return "Нет";
  return "";
}

export function csvDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export function csvCell(value: unknown): string {
  if (value == null || value === "") return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(cells: unknown[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

export async function streamCsv(
  c: Context,
  filename: string,
  headers: string[],
  rowIterator: AsyncIterable<unknown[]>,
): Promise<Response> {
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);

  return stream(c, async (s) => {
    await s.write(`\uFEFF${csvRow(headers)}`);
    for await (const row of rowIterator) {
      await s.write(csvRow(row));
    }
  });
}

/** Постраничная выборка без загрузки всей таблицы в память. */
export async function* paginate<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  pageSize = 500,
): AsyncGenerator<T> {
  let offset = 0;
  while (true) {
    const page = await fetchPage(offset, pageSize);
    if (!page.length) break;
    for (const row of page) yield row;
    if (page.length < pageSize) break;
    offset += pageSize;
  }
}
