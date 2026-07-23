import { useEffect } from "react";
import { useLocation } from "wouter";
import { useOpenTabs } from "../lib/open-tabs";
import { labelForPath } from "../lib/nav";

export function OpenTabsBar() {
  const [location, setLocation] = useLocation();
  const { tabs, openTab, closeTab } = useOpenTabs();

  useEffect(() => {
    if (location === "/login") return;
    openTab(location, labelForPath(location));
  }, [location, openTab]);

  if (tabs.length === 0) return null;

  return (
    <div className="crm-open-tabs" role="tablist" aria-label="Открытые разделы">
      {tabs.map((tab) => {
        const active = location === tab.path;
        return (
          <div
            key={tab.path}
            className={`crm-open-tab${active ? " is-active" : ""}`}
            role="tab"
            aria-selected={active}
          >
            <button
              type="button"
              className="crm-open-tab__main"
              onClick={() => setLocation(tab.path)}
              title={tab.title}
            >
              <span className="crm-open-tab__icon">{tab.icon}</span>
              <span className="crm-open-tab__title">{tab.title}</span>
            </button>
            <button
              type="button"
              className="crm-open-tab__close"
              aria-label={`Закрыть ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                const wasActive = location === tab.path;
                closeTab(tab.path);
                if (wasActive) {
                  const rest = tabs.filter((t) => t.path !== tab.path);
                  setLocation(rest.length ? rest[rest.length - 1].path : "/");
                }
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
