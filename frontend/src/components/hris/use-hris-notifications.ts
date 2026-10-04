"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";

export interface HrisNotification {
  id: string;
  title: string;
  message: string;
  type: "approval" | "status_change" | "reminder" | "alert";
  link: string | null;
  is_read: boolean;
  created_at: string;
}

const NOTIFICATIONS_KEY = ["hris", "notifications"] as const;
const POLL_MS = 30_000;

/** Notifikasi HRIS (poll 30 detik). Gagal memuat = diam, notifikasi tidak kritis. */
export function useHrisNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () =>
      apiGet<{ data?: HrisNotification[] }>("/api/hris/notifications?limit=30").then(
        (res) => res.data ?? []
      ),
    refetchInterval: POLL_MS,
  });
}

/** Tandai satu (id) atau semua (null) notifikasi sudah dibaca. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | null) =>
      apiPost("/api/hris/notifications", id ? { notification_id: id } : { mark_all: true }),
    onSuccess: (_res, id) => {
      qc.setQueryData<HrisNotification[]>(NOTIFICATIONS_KEY, (prev) =>
        prev?.map((n) => (id === null || n.id === id ? { ...n, is_read: true } : n))
      );
    },
  });
}
