"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchSupervisorCandidates, fetchSupervisors } from "./api";

export const supervisorsQueryKeys = {
  all: ["pos", "supervisors"] as const,
  list: () => ["pos", "supervisors", "list"] as const,
  candidates: (search: string) => ["pos", "supervisors", "candidates", search] as const,
};

export const useSupervisors = () =>
  useQuery({ queryKey: supervisorsQueryKeys.list(), queryFn: fetchSupervisors });

export const useSupervisorCandidates = (search: string, enabled: boolean) =>
  useQuery({
    queryKey: supervisorsQueryKeys.candidates(search.trim()),
    queryFn: () => fetchSupervisorCandidates(search),
    enabled,
  });
