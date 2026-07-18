import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./api/database/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.CRM_DB_PATH || "crm.db",
  },
});
