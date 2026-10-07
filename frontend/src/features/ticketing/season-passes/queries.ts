"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchPassOptions, fetchPasses, issuePass, renewPass } from "./api";
import type { IssuedPassResult, IssuePassValues } from "./types";

export const passQueryKeys = {
  all: ["ticketing", "season-passes"] as const,
  list: (q: string) => ["ticketing", "season-passes", "list", q] as const,
  options: ["ticketing", "season-passes", "options"] as const,
};

export const usePassOptions = () =>
  useQuery({
    queryKey: passQueryKeys.options,
    queryFn: fetchPassOptions,
  });

export const usePasses = (q: string) =>
  useQuery({
    queryKey: passQueryKeys.list(q),
    queryFn: () => fetchPasses(q),
  });

export const useRenewPass = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => renewPass(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: passQueryKeys.all });
      toast.success(`Pass diperpanjang s/d ${result.valid_until}`);
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : "Gagal memperpanjang pass"
      );
    },
  });
};

export const useIssuePass = (onSuccess: (result: IssuedPassResult) => void) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: IssuePassValues) => issuePass(values),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: passQueryKeys.all });
      toast.success(`Pass ${result.pass_code} diterbitkan`);
      onSuccess(result);
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : "Gagal menerbitkan pass"
      );
    },
  });
};
