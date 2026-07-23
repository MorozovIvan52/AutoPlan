#!/usr/bin/env node
/**
 * Run YAML workflow prompts via @cursor/sdk (local + optional cloud).
 * Does not print the API key.
 */
const fs = require("fs");
const path = require("path");
const { Agent, Cursor, CursorAgentError } = require("@cursor/sdk");

function loadEnv() {
  const env = { ...process.env };
  const t = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!env[m[1]]) env[m[1]] = v;
  }
  return env;
}

function extractPrompt(yaml) {
  const name = (yaml.match(/^name:\s*"(.*)"/m) || [, "workflow"])[1];
  const m = yaml.match(
    /prompts:\s*\n\s*-\s*\|\s*\n([\s\S]*?)(?:\n\s*model:|\n\s*agentOptions:|\n#|$)/
  );
  let prompt = m?.[1] || "";
  const lines = prompt.split("\n");
  const indents = lines
    .filter((l) => l.trim())
    .map((l) => (l.match(/^ */)?.[0].length ?? 0));
  const min = indents.length ? Math.min(...indents) : 0;
  prompt = lines.map((l) => l.slice(min)).join("\n").trim();
  return { name, prompt };
}

function resultText(result) {
  if (!result) return "";
  if (typeof result.result === "string") return result.result;
  if (result.result && typeof result.result === "object") {
    return JSON.stringify(result.result, null, 2);
  }
  return JSON.stringify(result, null, 2);
}

async function main() {
  const env = loadEnv();
  const apiKey = (env.CURSOR_API_KEY || "").trim();
  if (!apiKey) {
    console.error("CURSOR_API_KEY empty");
    process.exit(2);
  }

  const outDir = path.join(process.cwd(), "docs", "agents", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  console.log("Auth check: Cursor.me ...");
  try {
    const me = await Cursor.me({ apiKey });
    console.log(
      "OK user=",
      me?.email || me?.name || me?.id || JSON.stringify(me).slice(0, 120)
    );
  } catch (e) {
    console.error("Cursor.me failed:", e.message || e);
    process.exit(1);
  }

  let repos = [];
  try {
    repos = await Cursor.repositories.list({ apiKey });
    console.log("Connected repos:", repos.length);
    for (const r of repos.slice(0, 15)) {
      console.log(" -", r.url || r.name || JSON.stringify(r).slice(0, 100));
    }
  } catch (e) {
    console.warn("repositories.list:", e.message || e);
  }

  const target =
    repos.find((r) =>
      String(r.url || r.name || "").toLowerCase().includes("crmautoplan")
    ) ||
    repos.find((r) =>
      String(r.url || "").includes("MorozovIvan52")
    );

  const wfDir = path.join(process.cwd(), "docs", "agents", "workflows");
  const files = fs.readdirSync(wfDir).filter((f) => f.endsWith(".yaml"));
  const summary = [`# SDK agent run ${stamp}`, ""];

  // 1) LOCAL runs for all workflows (fast, real code access)
  for (const f of files) {
    const yaml = fs.readFileSync(path.join(wfDir, f), "utf8");
    const { name, prompt } = extractPrompt(yaml);
    const fullPrompt =
      prompt +
      "\n\nРаботай в текущем репозитории. Прочитай AGENTS.md и .cursor/rules/crm-cloud-analyst.mdc. Ответ только markdown на русском.";
    console.log(`\n=== LOCAL: ${name} ===`);
    try {
      const result = await Agent.prompt(fullPrompt, {
        apiKey,
        model: { id: "composer-2.5" },
        name: `local-${f.replace(/\.yaml$/, "")}`,
        local: { cwd: process.cwd() },
      });
      const body = resultText(result);
      const out = path.join(outDir, `${stamp}_sdk-local_${f.replace(/\.yaml$/, "")}.md`);
      fs.writeFileSync(
        out,
        `# ${name} (SDK local)\n\nstatus=${result.status}\nagent=${result.agentId || ""}\nrun=${result.id || ""}\n\n${body}\n`,
        "utf8"
      );
      console.log("Wrote", out, "status=", result.status);
      summary.push(`## LOCAL ${name}`, `status=${result.status}`, body.slice(0, 2500), "");
    } catch (e) {
      const msg = e instanceof CursorAgentError ? e.message : String(e);
      console.error("FAIL", name, msg);
      summary.push(`## LOCAL ${name} FAIL`, msg, "");
    }
  }

  // 2) One CLOUD run (morning briefing) if repo connected
  if (target?.url) {
    console.log(`\n=== CLOUD morning briefing on ${target.url} ===`);
    const yaml = fs.readFileSync(
      path.join(wfDir, "crm-morning-briefing.yaml"),
      "utf8"
    );
    const { prompt } = extractPrompt(yaml);
    try {
      const result = await Agent.prompt(
        prompt +
          "\n\nCloud agent: clone this repo, read AGENTS.md, produce Russian markdown briefing. No invented live DB numbers.",
        {
          apiKey,
          model: { id: "composer-2.5" },
          name: "CRM morning briefing cloud",
          cloud: {
            repos: [{ url: target.url, startingRef: "main" }],
            skipReviewerRequest: true,
          },
        }
      );
      const body = resultText(result);
      const out = path.join(outDir, `${stamp}_sdk-cloud_morning-briefing.md`);
      fs.writeFileSync(
        out,
        `# Cloud morning briefing\n\nrepo=${target.url}\nstatus=${result.status}\nagent=${result.agentId || ""}\nrun=${result.id || ""}\n\n${body}\n`,
        "utf8"
      );
      console.log("Wrote", out, "status=", result.status, "agent=", result.agentId);
      summary.push(`## CLOUD morning`, `status=${result.status} agent=${result.agentId}`, body.slice(0, 2500), "");
    } catch (e) {
      const msg = e instanceof CursorAgentError ? `${e.message} retryable=${e.isRetryable}` : String(e);
      console.error("CLOUD FAIL", msg);
      summary.push(`## CLOUD FAIL`, msg, "");
    }
  } else {
    console.warn(
      "No crmAutoPlan in Cursor.repositories — connect GitHub in Cursor Integrations for cloud runs."
    );
    summary.push(
      "## CLOUD skipped",
      "Repo not connected in Cursor. Open https://cursor.com/dashboard → Integrations → GitHub.",
      ""
    );
  }

  const sumPath = path.join(outDir, `${stamp}_SDK_SUMMARY.md`);
  fs.writeFileSync(sumPath, summary.join("\n"), "utf8");
  console.log("\nSUMMARY", sumPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
