"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPortalSession, finishPortalSession, startPortalSession, startPortalTest } from "./api";
import { requestFullscreen } from "./hooks/use-proctoring";

const sessionKey = (token: string) => ["psikotes-portal", token] as const;

/** Ringkasan sesi kandidat; token salah = galat final, tanpa retry. */
export function usePsikotesSession(token: string) {
  return useQuery({
    queryKey: sessionKey(token),
    queryFn: () => fetchPortalSession(token),
    retry: false,
  });
}

/** Muat ulang ringkasan sesi (setelah aksi kandidat). */
export function useRefreshPsikotesSession(token: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: sessionKey(token) });
}

export function useStartPsikotesSession(token: string) {
  const refresh = useRefreshPsikotesSession(token);
  return useMutation({
    mutationFn: async (webcamConsent: boolean) => {
      await startPortalSession(token, webcamConsent);
      requestFullscreen();
    },
    onSuccess: refresh,
    retry: false,
  });
}

export function useStartPsikotesTest(token: string) {
  return useMutation({
    mutationFn: (testId: string) => startPortalTest(token, testId),
    retry: false,
  });
}

export function useFinishPsikotesSession(token: string) {
  const refresh = useRefreshPsikotesSession(token);
  return useMutation({
    mutationFn: () => finishPortalSession(token),
    onSuccess: refresh,
    retry: false,
  });
}
