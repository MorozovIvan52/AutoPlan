/** PM2: CRM всегда онлайн. SQLite — только 1 процесс (instances: 1). */
module.exports = {
  apps: [
    {
      name: "crm",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "server.prod.ts",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 30,
      restart_delay: 5000,
      /** Мягкий рестарт до OOM — на VPS 6 GB, CRM ~1.5 GB heap */
      max_memory_restart: "1700M",
      env: {
        NODE_ENV: "production",
        PORT: 4200,
        NODE_OPTIONS: "--max-old-space-size=1536",
        AVITO_POLL_INTERVAL_SECONDS: "120",
        TELEGRAM_POLLING_IN_APP: "false",
        AVITO_POLL_MAX_RECENT: "40",
        CRM_DOCS_DIR: "/opt/crm/docs",
        PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium-browser",
      },
      error_file: "logs/crm-error.log",
      out_file: "logs/crm-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
