import { defineConfig } from "drizzle-kit";

/** Drizzle push для PostgreSQL (после миграции данных). */
export default defineConfig({
  schema: "./api/database/schema.ts",
  out: "./drizzle-pg",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
