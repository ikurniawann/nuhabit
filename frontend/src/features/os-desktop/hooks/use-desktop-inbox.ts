"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboxSection } from "@/lib/desktop/inbox";

const INBOX_KEY = ["os-desktop", "inbox"] as const;

/** Kotak keputusan panel Hari Ini; dimuat ulang setiap panel dibuka. */
export function useDesktopInbox() {
  return useQuery({
    queryKey: INBOX_KEY,
    queryFn: async (): Promise<InboxSection[]> => {
      const res = await fetch("/api/desktop/inbox");
      const json = res.ok ? await res.json() : null;
      return Array.isArray(json?.data?.sections) ? json.data.sections : [];
    },
    staleTime: 0,
    retry: false,
  });
}

/** Setujui/tolak cuti lewat API approval resmi (potong kuota + notifikasi). */
export function useDecideLeave() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      const res = await fetch("/api/hris/leaves/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leave_id: id,
          action,
          ...(action === "reject" ? { rejection_reason: "Ditolak dari panel Hari Ini" } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Gagal memproses");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INBOX_KEY }),
    onError: (error) => window.alert(error.message || "Gagal memproses"),
  });
}
