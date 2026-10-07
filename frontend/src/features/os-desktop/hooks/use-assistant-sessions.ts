"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssistantSession } from "../lib/assistant-chat";
import { deleteSession, fetchSessions, renameSession } from "./assistant-api";

const SESSIONS_KEY = ["os-desktop", "assistant-sessions"] as const;

/** Riwayat chat Do: daftar, ganti nama (optimistik), dan hapus. */
export function useAssistantSessions(enabled: boolean) {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: fetchSessions,
    enabled,
    staleTime: 0,
    retry: false,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });

  const rename = useMutation({
    retry: false,
    mutationFn: ({ id, title }: { id: string; title: string }) => renameSession(id, title),
    // Judul langsung berubah di daftar, dikembalikan bila gagal.
    onMutate: ({ id, title }) => {
      const before = queryClient.getQueryData<AssistantSession[]>(SESSIONS_KEY);
      queryClient.setQueryData<AssistantSession[]>(SESSIONS_KEY, (prev = []) =>
        prev.map((item) => (item.id === id ? { ...item, title } : item))
      );
      return { before };
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(SESSIONS_KEY, context?.before),
  });

  const remove = useMutation({
    retry: false,
    mutationFn: deleteSession,
    onSuccess: (_data, id) =>
      queryClient.setQueryData<AssistantSession[]>(SESSIONS_KEY, (prev = []) => prev.filter((session) => session.id !== id)),
  });

  return { sessions: sessions.data ?? [], refresh, rename, remove };
}
