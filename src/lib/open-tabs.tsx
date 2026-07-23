import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { iconForPath, labelForPath } from "./nav";

export type OpenTab = {
  path: string;
  title: string;
  icon: string;
};

type Ctx = {
  tabs: OpenTab[];
  openTab: (path: string, title?: string) => void;
  closeTab: (path: string) => void;
  closeOthers: (path: string) => void;
};

const TabsCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "crm_open_tabs_v1";

function loadTabs(): OpenTab[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OpenTab[];
    return Array.isArray(parsed) ? parsed.filter((t) => t?.path) : [];
  } catch {
    return [];
  }
}

function saveTabs(tabs: OpenTab[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.slice(0, 12)));
  } catch {
    /* ignore */
  }
}

export function OpenTabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<OpenTab[]>(() => loadTabs());

  const openTab = useCallback((path: string, title?: string) => {
    setTabs((prev) => {
      const exists = prev.find((t) => t.path === path);
      if (exists) {
        const next = prev.map((t) =>
          t.path === path
            ? { ...t, title: title || t.title || labelForPath(path) }
            : t,
        );
        saveTabs(next);
        return next;
      }
      const next = [
        ...prev,
        {
          path,
          title: title || labelForPath(path),
          icon: iconForPath(path),
        },
      ].slice(-12);
      saveTabs(next);
      return next;
    });
  }, []);

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      saveTabs(next);
      return next;
    });
  }, []);

  const closeOthers = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path === path);
      saveTabs(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ tabs, openTab, closeTab, closeOthers }),
    [tabs, openTab, closeTab, closeOthers],
  );

  return <TabsCtx.Provider value={value}>{children}</TabsCtx.Provider>;
}

export function useOpenTabs() {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("useOpenTabs outside provider");
  return ctx;
}
