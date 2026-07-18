import { Hono } from "hono";
import type { Context } from "hono";
import { requireAuth } from "../middleware/auth";
import { saveUpload, readUpload } from "../lib/uploads";
import { normalizeUploadFilename } from "../lib/media";
import { jsonApiError } from "../lib/api-error";

export async function handleUploadPost(c: Context) {
  const body = await c.req.parseBody();
  const file = body.file ?? body.image ?? body["uploadfile[]"];
  if (!file || typeof file === "string") {
    return c.json({ error: "Выберите файл (поле file)" }, 400);
  }

  const f = file as File;
  const buffer = Buffer.from(await f.arrayBuffer());
  try {
    const saved = saveUpload(buffer, normalizeUploadFilename(f.name || "", f.type), f.type);
    return c.json({ url: saved.url, filename: saved.filename, mime: saved.mime }, 201);
  } catch (e: unknown) {
    return jsonApiError(c, e, "Ошибка загрузки", 400, "upload");
  }
}

export async function handleUploadGet(c: Context) {
  const filename = c.req.param("filename");
  if (!filename) return c.json({ error: "Not found" }, 404);
  const data = readUpload(filename);
  if (!data) return c.json({ error: "Not found" }, 404);
  const download = c.req.query("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": data.mime,
    "Cache-Control": "private, max-age=3600",
  };
  if (download) {
    const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
    headers["Content-Disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }
  return new Response(new Uint8Array(data.buffer), { headers });
}

/** Sub-router (legacy mount) */
export const uploads = new Hono()
  .use("*", requireAuth)
  .post("/", handleUploadPost)
  .get("/:filename", handleUploadGet);
