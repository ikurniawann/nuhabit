"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mergeChatMessages } from "@/lib/recruitment/live-monitoring-view";
import {
  fetchLiveMonitorChat,
  fetchLiveSessions,
  sendLiveMonitorChat,
  type LiveMonitorChatMessage,
  type LiveSessionType,
} from "./api";

const CHAT_POLL_MS = 4_000;

const keys = {
  sessions: () => ["hris", "live-monitoring", "sessions"] as const,
  chat: (type: LiveSessionType, sessionId: string) =>
    ["hris", "live-monitoring", "chat", type, sessionId] as const,
};

/** Daftar sesi berjalan: dipoll supaya thumbnail selalu segar. */
export const useLiveSessions = () =>
  useQuery({
    queryKey: keys.sessions(),
    queryFn: fetchLiveSessions,
    refetchInterval: 8_000,
  });

/**
 * Live chat satu sesi, polling 4 dtk. Tiap poll hanya mengambil pesan setelah
 * pesan terakhir di cache lalu digabung (dedupe per id).
 */
export function useLiveChat(type: LiveSessionType, sessionId: string) {
  const qc = useQueryClient();
  const queryKey = keys.chat(type, sessionId);
  return useQuery({
    queryKey,
    queryFn: async () => {
      const prev = qc.getQueryData<LiveMonitorChatMessage[]>(queryKey) ?? [];
      const incoming = await fetchLiveMonitorChat(type, sessionId, prev.at(-1)?.created_at);
      return mergeChatMessages(prev, incoming);
    },
    refetchInterval: CHAT_POLL_MS,
  });
}

export function useSendLiveChat(type: LiveSessionType, sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => sendLiveMonitorChat(type, sessionId, message),
    onSuccess: (saved) =>
      qc.setQueryData<LiveMonitorChatMessage[]>(keys.chat(type, sessionId), (prev) =>
        mergeChatMessages(prev ?? [], [saved])
      ),
  });
}
