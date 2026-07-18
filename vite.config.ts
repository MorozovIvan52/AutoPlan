import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const BUILD_ID = process.env.CRM_BUILD_ID || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function crmBuildIdPlugin(): Plugin {
  return {
    name: "crm-build-id",
    transformIndexHtml(html) {
      return html.replace(
        "</head>",
        `    <meta name="crm-build-id" content="${BUILD_ID}" />\n  </head>`,
      );
    },
    closeBundle() {
      const out = join(process.cwd(), "dist", "crm-build-id.json");
      writeFileSync(out, JSON.stringify({ id: BUILD_ID }, null, 0));
    },
  };
}

export default defineConfig({
  plugins: [react(), crmBuildIdPlugin()],
  define: {
    __CRM_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    middlewareMode: true,
  },
});
