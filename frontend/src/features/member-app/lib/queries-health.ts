"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memberApi } from "./api";
import type { ParqStatus } from "./parq";

/** Data hooks for the PAR-Q health declaration (/api/member-portal/gym/health). */

const key = ["member-app", "health"] as const;

export function useParq() {
  return useQuery({ queryKey: key, queryFn: () => memberApi<ParqStatus>("/gym/health") });
}

export function useSubmitParq() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { answers: Record<string, boolean>; details: string }) =>
      memberApi<ParqStatus>("/gym/health", { method: "POST", json: input }),
    onSuccess: (status) => qc.setQueryData(key, status),
  });
}
