"use client";

import { useQuery } from "@tanstack/react-query";
import { call } from "./shared";

export interface GymBranch {
  id: string;
  name: string;
}

export interface GymBranches {
  branches: GymBranch[];
  /** Cabang akun staf (configuration.users.branch_id); null untuk akun lintas cabang. */
  current_branch_id: string | null;
}

/** Cabang awal form gym: cabang akun staf, atau satu-satunya cabang; "" bila harus dipilih. */
export function defaultBranchId(data: GymBranches | undefined): string {
  if (!data) return "";
  if (data.current_branch_id && data.branches.some((b) => b.id === data.current_branch_id)) return data.current_branch_id;
  return data.branches.length === 1 ? data.branches[0].id : "";
}

export const GYM_BRANCHES_KEY = ["gym", "branches"] as const;

/** Daftar cabang aktif dan cabang staf yang sedang login. */
export function useGymBranches() {
  return useQuery({
    queryKey: GYM_BRANCHES_KEY,
    queryFn: () => call<GymBranches>("/api/gym/branches"),
    staleTime: 5 * 60 * 1000,
  });
}
