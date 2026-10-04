"use client";

import { useQuery } from "@tanstack/react-query";
import { brandName } from "@/lib/branding";
import { fetchCurrentUser } from "@/hooks/use-auth";

export type OsUserAccount = { email: string; fullName: string; role: string };

/** Akun yang sedang masuk; null = pengunjung (desktop tetap tampil dalam mode tamu). */
export function useDesktopAccount(): OsUserAccount | null {
  const { data } = useQuery({
    queryKey: ["os-desktop", "account"],
    queryFn: async (): Promise<OsUserAccount | null> => {
      const user = await fetchCurrentUser();
      if (!user) return null;
      return {
        email: user.email,
        fullName: user.full_name || user.email || `${brandName()} User`,
        role: user.role ?? "authenticated",
      };
    },
    staleTime: Infinity,
    retry: false,
  });
  return data ?? null;
}
