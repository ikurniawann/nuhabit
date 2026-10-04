"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchInterviewSession } from "./api";

const sessionKey = (token: string) => ["interview-portal", token] as const;

/** Ringkasan sesi interview kandidat; token salah = galat final, tanpa retry. */
export function useInterviewSession(token: string) {
  return useQuery({ queryKey: sessionKey(token), queryFn: () => fetchInterviewSession(token), retry: false });
}

/** Muat ulang ringkasan sesi setelah aksi kandidat. */
export function useRefreshInterviewSession(token: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: sessionKey(token) });
}
