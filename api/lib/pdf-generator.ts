/**
 * HTML → PDF через Puppeteer (headless Chromium).
 */
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";

export type PdfGenerateOptions = {
  format?: "A4";
  marginMm?: number;
  displayHeaderFooter?: boolean;
};

function resolveChromePath(): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidates.find((p) => fs.existsSync(p));
}

export async function generatePdf(
  html: string,
  options: PdfGenerateOptions = {},
): Promise<Buffer> {
  const marginMm = options.marginMm ?? 12;
  const margin = `${marginMm}mm`;

  let puppeteer: typeof import("puppeteer");
  try {
    puppeteer = await import("puppeteer");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Puppeteer не установлен: ${msg}. Выполните npm install puppeteer`);
  }

  const executablePath = resolveChromePath();
  const launchOpts: Parameters<typeof puppeteer.launch>[0] = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=medium",
    ],
  };
  if (executablePath) {
    launchOpts.executablePath = executablePath;
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    const pdf = await page.pdf({
      format: options.format ?? "A4",
      printBackground: true,
      margin: { top: margin, right: margin, bottom: "18mm", left: margin },
      displayHeaderFooter: options.displayHeaderFooter ?? true,
      headerTemplate: `<div></div>`,
      footerTemplate: `
        <div style="font-size:8px;width:100%;text-align:center;color:#666;padding:0 12mm;">
          Страница <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
    });
    return Buffer.from(pdf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ error: msg, chrome: executablePath || "bundled" }, "pdf_generate_failed");
    throw new Error(
      `Не удалось сформировать PDF. Проверьте Chromium на сервере (apt install chromium-browser). Детали: ${msg}`,
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

export function getDocsDir(): string {
  const fromEnv = process.env.CRM_DOCS_DIR;
  if (fromEnv) return fromEnv;
  if (fs.existsSync("/opt/crm")) return "/opt/crm/docs";
  return path.join(process.cwd(), "generated-docs");
}

export function ensureDocsDir(): string {
  const dir = getDocsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
