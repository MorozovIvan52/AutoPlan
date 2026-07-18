import { useLocation } from "wouter";

const TABS = [
  { path: "/zn", label: "Заказ-наряды" },
  { path: "/sales", label: "Реализации" },
  { path: "/warehouse", label: "Номенклатура" },
  { path: "/procurement", label: "Проценка" },
] as const;

export function StoModuleTabs() {
  const [location, setLocation] = useLocation();

  return (
    <nav className="sto-mod-tabs">
      {TABS.map((tab) => {
        const active = location === tab.path || (tab.path === "/zn" && location.startsWith("/zn"));
        return (
          <button
            key={tab.path}
            type="button"
            className={`sto-mod-tabs__item${active ? " sto-mod-tabs__item--on" : ""}`}
            onClick={() => setLocation(tab.path)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
