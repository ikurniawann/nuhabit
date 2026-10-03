"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MemberPromo } from "@/lib/member-portal/promos";
import { promoLabel } from "@/lib/member-app/home";
import type {
  AnnouncementView,
  BookingView,
  HomeFeedView,
  MemberAccountView,
  MemberSettingsView,
  VisitView,
} from "@/lib/member-app/home-views";
import { memberApi } from "./api";

/** Hook data layar beranda & akun (port lib/queries.ts referensi). */
export const homeKeys = {
  account: ["member-app", "account"] as const,
  feed: ["member-app", "home"] as const,
  promos: ["member-app", "promos"] as const,
  bookings: ["member-app", "active-bookings"] as const,
  visits: ["member-app", "visits"] as const,
  notifications: ["member-app", "notifications"] as const,
  announcement: (id: string) => ["member-app", "announcement", id] as const,
  qr: ["member-app", "qr"] as const,
  settings: ["member-app", "settings"] as const,
};

export const useAccount = () =>
  useQuery({ queryKey: homeKeys.account, queryFn: () => memberApi<MemberAccountView>("/app/home/me") });

export const useHomeFeed = () =>
  useQuery({ queryKey: homeKeys.feed, queryFn: () => memberApi<HomeFeedView>("/app/home") });

export const useMyBookings = () =>
  useQuery({ queryKey: homeKeys.bookings, queryFn: () => memberApi<BookingView[]>("/app/home/bookings") });

export const useMyVisits = () =>
  useQuery({ queryKey: homeKeys.visits, queryFn: () => memberApi<VisitView[]>("/app/home/visits") });

export const useSettings = () =>
  useQuery({ queryKey: homeKeys.settings, queryFn: () => memberApi<MemberSettingsView>("/app/home/settings") });

export const useAnnouncement = (id: string) =>
  useQuery({
    queryKey: homeKeys.announcement(id),
    queryFn: () => memberApi<AnnouncementView>(`/app/home/announcements/${encodeURIComponent(id)}`),
  });

export interface PromoView {
  code: string;
  label: string;
  description: string;
  /** Promo masih bisa dipakai member ini (belum habis jatahnya). */
  live: boolean;
  startsAt: string | null;
  endsAt: string | null;
  perMemberLimit: number | null;
  scope: MemberPromo["scope"];
}

export const usePromos = () =>
  useQuery({
    queryKey: homeKeys.promos,
    queryFn: async () =>
      (await memberApi<MemberPromo[]>("/promos")).map(
        (p): PromoView => ({
          code: p.code,
          label: promoLabel(p.discount_type, p.value),
          description: p.description || p.name,
          live: !p.used_up,
          startsAt: p.valid_from,
          endsAt: p.valid_until,
          perMemberLimit: p.per_member_limit,
          scope: p.scope,
        })
      ),
  });

export interface MemberNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export const useNotifications = () =>
  useQuery({
    queryKey: homeKeys.notifications,
    queryFn: async () => {
      const data = await memberApi<{
        notifications: Array<{ id: string; type: string; title: string; body: string; created_at: string; read_at: string | null }>;
      }>("/notifications");
      return data.notifications.map(
        (n): MemberNotification => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          createdAt: n.created_at,
          readAt: n.read_at,
        })
      );
    },
  });

interface QrView {
  token: string;
  expiresAt: string;
  ttlSeconds: number;
}

/** QR gate yang diterbitkan ulang otomatis begitu token lama kedaluwarsa. */
export const useMemberQr = () =>
  useQuery({
    queryKey: homeKeys.qr,
    queryFn: async (): Promise<QrView> => {
      const qr = await memberApi<{ token: string; expires_at: string; ttl_seconds: number }>("/qr", {
        method: "POST",
      });
      return { token: qr.token, expiresAt: qr.expires_at, ttlSeconds: qr.ttl_seconds };
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return Math.max(1_000, new Date(data.expiresAt).getTime() - Date.now());
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 0,
  });

/** Perubahan booking/kredit/profil menyentuh beberapa layar sekaligus. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
