"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserRole } from "@/types";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  full_name?: string;
}

interface UseAuthResult {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

interface MeResponse {
  success: boolean;
  data?: { id: string; email: string; role: UserRole | null; full_name: string | null };
}

export const authMeQueryKey = ["auth", "me"] as const;

/** Profil user login dari /api/auth/me; null bila tidak ada sesi. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return null;
  const json = (await res.json()) as MeResponse;
  if (!json.success || !json.data) return null;
  return {
    id: json.data.id,
    email: json.data.email ?? "",
    role: json.data.role ?? "purchasing_staff",
    full_name: json.data.full_name ?? undefined,
  };
}

/** User yang sedang login (null bila tidak ada sesi aktif). */
export function useAuth(): UseAuthResult {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: authMeQueryKey,
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.setQueryData(authMeQueryKey, null);
  }

  return { user: data ?? null, loading: isPending, signOut };
}
