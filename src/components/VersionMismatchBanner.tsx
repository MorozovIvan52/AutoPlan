import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { checkAppVersion, hardReloadApp } from "../lib/app-version-guard";
import { apiFetchVoid } from "../lib/fetch-api";

const CHECK_MS = 45_000;
const AUTO_RELOAD_MS = 45_000;

export function VersionMismatchBanner() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let autoTimer: ReturnType<typeof setTimeout> | null = null;

    const report = async (source: string, buildId: string, expected: string) => {
      try {
        await apiFetchVoid("/api/client-errors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "version_mismatch",
            source,
            buildId,
            expected,
            url: location.href,
          }),
        });
      } catch {
        /* ignore */
      }
    };

    const run = async () => {
      const r = await checkAppVersion();
      if (cancelled) return;
      if (r.ok) {
        setOpen(false);
        if (autoTimer) {
          clearTimeout(autoTimer);
          autoTimer = null;
        }
        return;
      }
      setOpen(true);
      setDetail(`${r.source}: ${r.buildId} ≠ ${r.expected}`);
      void report(r.source, r.buildId, r.expected);
      if (!autoTimer) {
        autoTimer = setTimeout(() => hardReloadApp("version_mismatch_auto"), AUTO_RELOAD_MS);
      }
    };

    void run();
    const iv = setInterval(() => void run(), CHECK_MS);
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      clearInterval(iv);
      if (autoTimer) clearTimeout(autoTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (!open) return null;

  const host = document.getElementById("crm-overlays") || document.body;

  return createPortal(
    <div
      role="status"
      data-testid="version-mismatch-banner"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "10px 16px",
        background: "#0b1f3a",
        color: "#fff",
        fontSize: 14,
        boxShadow: "0 2px 12px rgba(0,0,0,.35)",
        pointerEvents: "auto",
      }}
    >
      <span>Обновляем интерфейс… У вас устаревшая версия страницы.</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          hardReloadApp("version_mismatch_click");
        }}
        style={{
          background: "#2563eb",
          color: "#fff",
          border: 0,
          borderRadius: 8,
          padding: "8px 14px",
          fontWeight: 600,
          cursor: busy ? "wait" : "pointer",
          pointerEvents: "auto",
        }}
      >
        {busy ? "Обновление…" : "Обновить сейчас"}
      </button>
      {import.meta.env.DEV && detail ? (
        <span style={{ opacity: 0.7, fontSize: 11 }}>{detail}</span>
      ) : null}
    </div>,
    host,
  );
}
