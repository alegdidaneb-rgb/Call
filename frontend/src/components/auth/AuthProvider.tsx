import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getCurrentUser, onAuthStateChange } from "@/lib/auth";
import type { AppUser } from "@/types/app";

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  isManager: false,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await getCurrentUser());
    } catch (err) {
      console.error("[auth] failed to resolve current user:", err);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const resolved = await getCurrentUser();
        if (active) setUser(resolved);
      } catch (err) {
        console.error("[auth] session bootstrap failed:", err);
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    const {
      data: { subscription },
    } = onAuthStateChange((next) => {
      if (!active) return;
      setUser(next);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextType = {
    user,
    loading,
    isAdmin: user?.role === "admin",
    isManager: user?.role === "manager",
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
