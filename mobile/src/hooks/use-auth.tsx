import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { clearSessionToken, getSessionToken, saveSessionToken } from "@/lib/session";
import { fetchMe, logoutRequest } from "@/lib/api";

/**
 * State sesi member utk guard rute (EPIC-044 Fase A).
 *
 * Saat app dibuka: token dibaca dari SecureStore lalu divalidasi ke server
 * via GET /me — token kedaluwarsa/dihapus di sisi server otomatis jadi guest.
 */
export type AuthStatus = "loading" | "authed" | "guest";

interface AuthContextValue {
  status: AuthStatus;
  /** Dipanggil verify OTP sukses — simpan token & tandai authed. */
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getSessionToken();
      if (!token) {
        if (!cancelled) setStatus("guest");
        return;
      }
      // Validasi token ke server; /me 401 = sesi mati → guest.
      const me = await fetchMe();
      if (!cancelled) setStatus(me.status === 401 ? "guest" : "authed");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (token: string) => {
    await saveSessionToken(token);
    setStatus("authed");
  }, []);

  const signOut = useCallback(async () => {
    await logoutRequest().catch(() => undefined);
    await clearSessionToken();
    setStatus("guest");
  }, []);

  const value = useMemo(
    () => ({ status, signIn, signOut }),
    [status, signIn, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}
