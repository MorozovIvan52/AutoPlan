/**
 * One-shot AI consult using .env AI_* (OpenAI-compatible).
 * Usage: npx tsx scripts/ai-consult.ts "question"
 *        npx tsx scripts/ai-consult.ts --file docs/x.md "question"
 */
import fs from "node:fs";
import path from "node:path";

function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] != null && process.env[m[1]] !== "") continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnv(path.resolve(process.cwd(), ".env"));

async function main() {
  const args = process.argv.slice(2);
  let fileCtx = "";
  const qParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
      const fp = path.resolve(process.cwd(), args[++i]);
      fileCtx += `\n\n--- FILE ${fp} ---\n` + fs.readFileSync(fp, "utf8").slice(0, 120_000);
    } else {
      qParts.push(args[i]);
    }
  }
  const question = qParts.join(" ").trim();
  if (!question) {
    console.error("Usage: npm run ai:consult -- \"question\"");
    process.exit(2);
  }

  const base = (process.env.AI_BASE_URL || "").replace(/\/$/, "");
  const key = process.env.AI_API_KEY || "";
  const model = process.env.AI_MODEL || "claude-sonnet-4-5";
  if (!base || !key) {
    console.error("AI_BASE_URL / AI_API_KEY missing in .env");
    process.exit(1);
  }

  const body = {
    model,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          "You are CRM Cloud Analyst for AutoPlan. Russian. Concrete. No invented live numbers. Cite code paths.",
      },
      {
        role: "user",
        content: question + (fileCtx ? `\n\nContext:${fileCtx}` : ""),
      },
    ],
  };

  const url = `${base}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("AI error", res.status, text.slice(0, 800));
    process.exit(1);
  }
  let content = text;
  try {
    const j = JSON.parse(text);
    content = j.choices?.[0]?.message?.content ?? text;
  } catch {
    /* raw */
  }
  console.log(content);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
