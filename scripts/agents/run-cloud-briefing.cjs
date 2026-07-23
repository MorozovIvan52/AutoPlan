#!/usr/bin/env node
/**
 * Once CURSOR_API_KEY is set: run Cloud Agent one-shot against GitHub repo
 * with morning-briefing prompt. Saves report under docs/agents/reports/.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function loadEnv() {
  const env = { ...process.env };
  const t = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!env[m[1]]) env[m[1]] = v;
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const key = (env.CURSOR_API_KEY || "").trim();
  if (!key) {
    console.error("CURSOR_API_KEY empty in .env — paste key from https://cursor.com/dashboard then re-run:");
    console.error("  npm run agent:cloud-briefing");
    process.exit(2);
  }

  // Prefer cursor-agent CLI (already installed)
  const agentCmd = path.join(process.env.LOCALAPPDATA || "", "cursor-agent", "agent.cmd");
  const prompt = fs.readFileSync(
    path.join(process.cwd(), "docs/agents/workflows/crm-morning-briefing.yaml"),
    "utf8"
  );
  const m = prompt.match(/prompts:\s*\n\s*-\s*\|\s*\n([\s\S]*?)(?:\n\s*model:|\n\s*agentOptions:)/);
  let p = m?.[1] || "Read AGENTS.md and produce morning CRM briefing in Russian.";
  const lines = p.split("\n");
  const ind = lines.filter((l) => l.trim()).map((l) => (l.match(/^ */)?.[0].length ?? 0));
  const min = ind.length ? Math.min(...ind) : 0;
  p = lines.map((l) => l.slice(min)).join("\n").trim();
  p +=
    "\n\nWork in this repo. Read AGENTS.md and .cursor/rules/crm-cloud-analyst.mdc. Output markdown only.";

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(process.cwd(), "docs", "agents", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${stamp}_cloud-morning-briefing.md`);

  if (fs.existsSync(agentCmd)) {
    console.log("Running cursor-agent --print (local tools, with API key)...");
    const r = spawnSync(
      agentCmd,
      ["--api-key", key, "--print", "--mode", "ask", "--output-format", "text", p],
      {
        encoding: "utf8",
        cwd: process.cwd(),
        env: { ...process.env, CURSOR_API_KEY: key },
        maxBuffer: 20 * 1024 * 1024,
        shell: true,
      }
    );
    const body = (r.stdout || "") + (r.stderr ? `\n\n<!-- stderr -->\n${r.stderr}` : "");
    fs.writeFileSync(outFile, `# Cloud morning briefing\n\nExit: ${r.status}\n\n${body}\n`, "utf8");
    console.log("Wrote", outFile, "exit", r.status);
    process.exit(r.status || 0);
  }

  console.error("cursor-agent not found; install @cursor/sdk or cursor-agent CLI");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
