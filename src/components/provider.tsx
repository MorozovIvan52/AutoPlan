import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext, type User } from "../lib/auth";
import { ToastProvider } from "../lib/toast";
import { OpenTabsProvider } from "../lib/open-tabs";
import { GlobalWsListener } from "./GlobalWsListener";
import { IncomingCallPopup } from "./IncomingCallPopup";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

export function Providers({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const setUserWithTheme = (u: User | null) => {
    setUser(u);
    if (u?.theme) {
      document.documentElement.setAttribute(
        "data-theme",
        u.theme === "dark-navy" ? "" : u.theme,
      );
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, setUser: setUserWithTheme }}>
        <ToastProvider>
          <OpenTabsProvider>
            <GlobalWsListener />
            <IncomingCallPopup />
            {children}
          </OpenTabsProvider>
        </ToastProvider>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}