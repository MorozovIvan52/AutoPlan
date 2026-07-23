import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { apiFetch, apiFetchVoid } from "../lib/fetch-api";
import { Avatar } from "./Avatar";
import { NotificationBell } from "./NotificationBell";
import { MONEY_PRIMARY, MONEY_RELATED, NAV } from "../lib/nav";
import { useOpenTabs } from "../lib/open-tabs";

export function Sidebar({
  unreadTotal,
  onSearchOpen,
}: {
  unreadTotal?: number;
  onSearchOpen?: () => void;
}) {
  const [location, setLocation] = useLocation();
  const { user, setUser } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const { openTab } = useOpenTabs();

  const { data: teamData } = useQuery({
    queryKey: ["team-chat-groups"],
    queryFn: () =>
      apiFetch<{ groups: { unreadCount?: number }[] }>("/api/team-chat/groups"),
    refetchInterval: 30000,
  });
  const teamUnread = (teamData?.groups || []).reduce(
    (s, g) => s + (g.unreadCount || 0),
    0,
  );

  const logout = async () => {
    await apiFetchVoid("/api/auth/logout", { method: "POST" });
    setUser(null);
    setLocation("/login");
  };

  const go = (path: string, label: string) => {
    openTab(path, label);
    setLocation(path);
    setMoneyOpen(false);
  };

  const isAdmin = user?.role === "admin";
  const visibleNav = NAV.filter((item) => !item.adminOnly || isAdmin);
  const moneyActive = location.startsWith("/money");

  return (
    <aside className={`app-sidebar crm-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="brand">
        <div className="brand__logo">{"\u{1F697}"}</div>
        <div className="brand-text">
          <div className="brand__text">AutoService</div>
          <div className="brand__sub">CRM · Запчасти</div>
        </div>
      </div>

      <nav className="nav">
        {onSearchOpen && (
          <button type="button" className="nav-item" onClick={onSearchOpen} title="Ctrl+K">
            <span className="nav-item__icon">{"\u{1F50D}"}</span>
            <span className="nav-label">Поиск</span>
            <kbd
              style={{
                marginLeft: "auto",
                fontSize: 9,
                padding: "2px 5px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
              }}
            >
              ⌘K
            </kbd>
          </button>
        )}
        {visibleNav.map(({ path, icon, label, flyout }) => {
          const active =
            location === path || (path !== "/" && location.startsWith(path));

          if (flyout && path === "/money") {
            return (
              <div
                key={path}
                className={`nav-flyout-wrap${moneyOpen || moneyActive ? " is-open" : ""}`}
                onMouseEnter={() => setMoneyOpen(true)}
                onMouseLeave={() => setMoneyOpen(false)}
              >
                <button
                  type="button"
                  className={`nav-item${moneyActive ? " active" : ""}`}
                  onClick={() => {
                    if (collapsed || window.matchMedia("(max-width: 900px)").matches) {
                      setMoneyOpen((v) => !v);
                      return;
                    }
                    go("/money", "Деньги");
                  }}
                  title={label}
                >
                  <span className="nav-item__icon">{icon}</span>
                  <span className="nav-label">{label}</span>
                  <span className="nav-flyout-caret">›</span>
                </button>
                {(moneyOpen || (collapsed && moneyOpen)) && (
                  <div className="nav-flyout" role="menu">
                    <div className="nav-flyout__head">
                      <span className="nav-flyout__star">☆</span>
                      <strong>Деньги</strong>
                    </div>
                    <div className="nav-flyout__section">
                      {MONEY_PRIMARY.map((item) => (
                        <button
                          key={item.path + item.label}
                          type="button"
                          className={`nav-flyout__item${location === item.path ? " is-active" : ""}`}
                          onClick={() => go(item.path, item.label)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="nav-flyout__related-title">Связанные темы</div>
                    <div className="nav-flyout__section">
                      {MONEY_RELATED.map((item) => (
                        <button
                          key={item.path}
                          type="button"
                          className={`nav-flyout__item nav-flyout__item--related${location === item.path ? " is-active" : ""}`}
                          onClick={() => go(item.path, item.label)}
                        >
                          <span className="nav-flyout__item-label">{item.label}</span>
                          {item.hint && <span className="nav-flyout__item-hint">{item.hint}</span>}
                        </button>
                      ))}
                    </div>
                    <p className="nav-flyout__desc">
                      Кассовые документы и отчёты по операциям поступления и движения средств на
                      предприятии.
                    </p>
                  </div>
                )}
              </div>
            );
          }

          return (
            <button
              key={path}
              type="button"
              className={`nav-item${active ? " active" : ""}`}
              onClick={() => go(path, label)}
              title={label}
            >
              <span className="nav-item__icon">{icon}</span>
              <span className="nav-label">{label}</span>
              {path === "/" && unreadTotal && unreadTotal > 0 ? (
                <span className="nav-badge">{unreadTotal > 99 ? "99+" : unreadTotal}</span>
              ) : null}
              {path === "/team" && teamUnread > 0 ? (
                <span className="nav-badge">{teamUnread > 99 ? "99+" : teamUnread}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <button type="button" className="collapse-btn" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? "»" : "« Свернуть"}
      </button>

      <div className="sidebar-foot">
        <NotificationBell />
        <div className="user-row">
          {user && <Avatar name={user.name} size={36} url={user.avatarUrl} />}
          <div className="user-info">
            <div className="user-name">{user?.name}</div>
            <div className="user-role">{user?.role === "admin" ? "Администратор" : "Оператор"}</div>
          </div>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-icon" onClick={logout} title="Выйти">
            ⎋
          </button>
        </div>
      </div>
    </aside>
  );
}
