/**
 * Run all docs/agents/workflows/*.yaml prompts via AI_* and save reports.
 * This is the executable stand-in until CURSOR_API_KEY + Automations UI are available.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const wfDir = path.join(root, "docs", "agents", "workflows");
const outDir = path.join(root, "docs", "agents", "reports");
fs.mkdirSync(outDir, { recursive: true });

function extractPrompt(yaml: string): { name: string; prompt: string } {
  const name = (yaml.match(/^name:\s*"(.*)"/m) || [, "workflow"])[1];
  const m = yaml.match(/prompts:\s*\n\s*-\s*\|\s*\n([\s\S]*?)(?:\n\s*model:|\n\s*agentOptions:|\n#|$)/);
  let prompt = m?.[1] || "";
  // unindent yaml block
  const lines = prompt.split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => (l.match(/^ */)?.[0].length ?? 0));
  const min = indents.length ? Math.min(...indents) : 0;
  prompt = lines.map((l) => l.slice(min)).join("\n").trim();
  return { name, prompt };
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const summary: string[] = [`# Agent workflow run ${stamp}`, ""];

const files = fs.readdirSync(wfDir).filter((f) => f.endsWith(".yaml"));
for (const f of files) {
  const yaml = fs.readFileSync(path.join(wfDir, f), "utf8");
  const { name, prompt } = extractPrompt(yaml);
  console.error(`\n=== Running: ${name} (${f}) ===\n`);
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", path.join(root, "scripts", "ai-consult.ts"), prompt],
    { encoding: "utf8", cwd: root, maxBuffer: 8 * 1024 * 1024 }
  );
  const body = (r.stdout || "") + (r.stderr && r.status !== 0 ? `\n\nSTDERR:\n${r.stderr}` : "");
  const safe = f.replace(/\.yaml$/, "");
  const outFile = path.join(outDir, `${stamp}_${safe}.md`);
  const md = `# ${name}\n\nSource: \`docs/agents/workflows/${f}\`\nGenerated: ${stamp}\nExit: ${r.status}\n\n${body}\n`;
  fs.writeFileSync(outFile, md, "utf8");
  summary.push(`## ${name}`, "", body.slice(0, 4000), "", `Full: \`${path.relative(root, outFile)}\``, "");
  console.error(`Wrote ${outFile} exit=${r.status}`);
}

const sumPath = path.join(outDir, `${stamp}_SUMMARY.md`);
fs.writeFileSync(sumPath, summary.join("\n"), "utf8");
console.log(`SUMMARY=${sumPath}`);
