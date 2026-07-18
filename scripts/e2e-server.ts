/**
 * Playwright webServer: поднимает production-сервер для E2E.
 */
import "../load-env.ts";

process.env.CRM_FORCE_SQLITE = process.env.CRM_FORCE_SQLITE || "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.TELEGRAM_POLLING_IN_APP = "false";
process.env.AVITO_POLL_INTERVAL_SECONDS = "9999";
process.env.PORT = process.env.PORT || "4200";

await import("../server.prod.ts");
