/** Продакшен по NODE_ENV — для решений безопасности */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Публичный HTTPS-деплой — строгие правила даже без NODE_ENV=production */
export function isPublicDeployment(): boolean {
  const url = (process.env.PUBLIC_URL || process.env.APP_URL || "").trim();
  return isProduction() || url.startsWith("https://");
}

/** Secure cookies / HSTS при HTTPS или явном prod */
export function isSecureCookies(): boolean {
  return isProduction() || (process.env.PUBLIC_URL || "").startsWith("https://");
}
