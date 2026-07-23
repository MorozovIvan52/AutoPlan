/**
 * Hard reload that busts HTML + module cache so version banner cannot stick.
 */
export function hardReloadApp(reason = "version_mismatch") {
  try {
    sessionStorage.setItem("crm_reload_reason", reason);
    sessionStorage.setItem("crm_reload_at", String(Date.now()));
  } catch {
    /* ignore */
  }
  const u = new URL(window.location.href);
  u.searchParams.set("_crm_reload", String(Date.now()));
  // Full navigation (not location.reload) avoids bfcache / sticky module graph
  window.location.replace(u.toString());
}

declare const __CRM_BUILD_ID__: string | undefined;

export function getHtmlBuildId(): string | null {
  return document.querySelector('meta[name="crm-build-id"]')?.getAttribute("content") || null;
}

export function getBundleBuildId(): string | null {
  try {
    if (typeof __CRM_BUILD_ID__ === "string" && __CRM_BUILD_ID__) return __CRM_BUILD_ID__;
  } catch {
    /* ignore */
  }
  return null;
}

export async function fetchServerBuildId(): Promise<string | null> {
  try {
    const r = await fetch(`/crm-build-id.json?_=${Date.now()}`, { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { id?: string };
      if (j?.id) return String(j.id);
    }
  } catch {
    /* ignore */
  }
  try {
    const r = await fetch(`/api/health?_=${Date.now()}`, { cache: "no-store", credentials: "include" });
    if (r.ok) {
      const j = (await r.json()) as { buildId?: string };
      if (j?.buildId) return String(j.buildId);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type VersionCheckResult =
  | { ok: true }
  | { ok: false; source: string; buildId: string; expected: string };

export async function checkAppVersion(): Promise<VersionCheckResult> {
  const htmlId = getHtmlBuildId();
  const bundleId = getBundleBuildId();
  const serverId = await fetchServerBuildId();

  if (htmlId && bundleId && htmlId !== bundleId) {
    return { ok: false, source: "html_vs_bundle", buildId: bundleId, expected: htmlId };
  }
  if (htmlId && serverId && htmlId !== serverId) {
    return { ok: false, source: "html_vs_server", buildId: htmlId, expected: serverId };
  }
  if (bundleId && serverId && bundleId !== serverId) {
    return { ok: false, source: "bundle_vs_server", buildId: bundleId, expected: serverId };
  }
  return { ok: true };
}
