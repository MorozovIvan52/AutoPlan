import { useState, useEffect, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { OpenTabsBar } from "./OpenTabsBar";

type Props = {
  children: ReactNode;
  unreadTotal?: number;
  fullWidth?: boolean;
  hideTopBar?: boolean;
  title?: string;
};

export function AppShell({ children, unreadTotal, fullWidth, hideTopBar, title }: Props) {
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="app-root">
      <Sidebar unreadTotal={unreadTotal} onSearchOpen={() => setCmdOpen(true)} />
      <div
        className="app-main"
        style={fullWidth ? { display: "flex", flexDirection: "column" } : undefined}
      >
        <OpenTabsBar />
        {!hideTopBar && <TopBar onSearchOpen={() => setCmdOpen(true)} title={title} />}
        {children}
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
