#!/usr/bin/env node
/**
 * Sync AI_* from local .env to VPS and deploy llm-aware ai routes.
 * Does not print secrets.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = process.cwd();
const keyPath = path.join(os.homedir(), ".ssh", "crm_vps_ed25519");
const host = "root@159.194.207.50";
const sshBase = ["-i", keyPath, "-o", "StrictHostKeyChecking=no"];

function loadEnv() {
  const env = {};
  const t = fs.readFileSync(path.join(root, ".env"), "utf8");
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

function ssh(args, input) {
  const r = spawnSync("ssh", [...sshBase, host, ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status || 1);
  }
  return r.stdout;
}

function scp(local, remote) {
  const r = spawnSync("scp", [...sshBase, local, `${host}:${remote}`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status || 1);
  }
}

const env = loadEnv();
const need = ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL"];
for (const k of need) {
  if (!env[k]) {
    console.error("Missing " + k + " in local .env");
    process.exit(1);
  }
}

const fragment = need.map((k) => `${k}=${env[k]}`).join("\n") + "\n";
const tmpFrag = path.join(os.tmpdir(), "crm-ai-env-fragment.env");
fs.writeFileSync(tmpFrag, fragment, { mode: 0o600 });

console.log("1) Upload AI env fragment (no echo)");
scp(tmpFrag, "/tmp/crm-ai-env-fragment.env");
fs.unlinkSync(tmpFrag);

console.log("2) Merge into /opt/crm/.env");
ssh([
  "bash",
  "-lc",
  `set -e
cd /opt/crm
cp -a .env .env.bak-ai-$(date +%Y%m%d%H%M%S)
# remove old AI_* lines then append
grep -vE '^(AI_BASE_URL|AI_API_KEY|AI_MODEL)=' .env > .env.tmp || true
cat /tmp/crm-ai-env-fragment.env >> .env.tmp
mv .env.tmp .env
chmod 600 .env
rm -f /tmp/crm-ai-env-fragment.env
# verify keys present without values
for k in AI_BASE_URL AI_API_KEY AI_MODEL; do
  if grep -q "^$k=." .env; then echo \"$k=SET\"; else echo \"$k=MISSING\"; fi
done
`,
]);

const files = [
  ["api/lib/llm.ts", "/opt/crm/api/lib/llm.ts"],
  ["api/routes/ai.ts", "/opt/crm/api/routes/ai.ts"],
];
console.log("3) Deploy ai.ts + llm.ts");
for (const [loc, rem] of files) {
  const full = path.join(root, loc);
  if (!fs.existsSync(full)) {
    console.error("missing " + loc);
    process.exit(1);
  }
  scp(full, rem);
}

// deps that ai.ts imports - ensure present
const maybe = [
  "api/lib/api-error.ts",
  "api/lib/tenant-query.ts",
  "api/lib/tenant-guard.ts",
  "api/lib/ocr-buffer.ts",
  "api/lib/yandex-vision.ts",
];
for (const loc of maybe) {
  const full = path.join(root, loc);
  if (fs.existsSync(full)) {
    scp(full, "/opt/crm/" + loc.replace(/\\/g, "/"));
  }
}

console.log("4) pm2 restart crm");
ssh(["bash", "-lc", "cd /opt/crm && pm2 restart crm --update-env && sleep 2 && pm2 status crm | head -20"]);

console.log("DONE");
