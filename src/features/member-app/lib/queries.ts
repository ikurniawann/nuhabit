"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, memberApi } from "./api";

/** Bentuk `me` yang dipakai kerangka aplikasi (header, guard). */
export interface MeView {
  member: { id: string; fullName: string; avatarUrl: string | null };
  unreadNotifications: number;
}

interface MeRaw {
  profile: { id: string; name: string | null; photo_url: string | null };
}

export const meKey = ["member-app", "me"] as const;

async function fetchMe(): Promise<MeView> {
  const [me, notif] = await Promise.all([
    memberApi<MeRaw>("/me"),
    memberApi<{ unread: number }>("/notifications").catch(() => ({ unread: 0 })),
  ]);
  return {
    member: {
      id: me.profile.id,
      fullName: me.profile.name ?? "Member",
      avatarUrl: me.profile.photo_url,
    },
    unreadNotifications: Number(notif.unread) || 0,
  };
}

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: fetchMe,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });
}
