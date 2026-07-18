export function getPublicUrl(): string {
  return (process.env.PUBLIC_URL || process.env.APP_URL || "http://localhost:4200").replace(/\/$/, "");
}

export function webhookUrl(type: string, identifier: string | number): string {
  return `${getPublicUrl()}/api/webhooks/${type}/${identifier}`;
}
