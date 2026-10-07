"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listMembers, getMemberDetailBundle } from "./api";
import { membersQueryKeys } from "./query-keys";
import type { MemberListParams } from "./types";

export const useMemberList = (params: MemberListParams) =>
  useQuery({
    queryKey: membersQueryKeys.list(params),
    queryFn: () => listMembers(params),
    placeholderData: keepPreviousData,
  });

export const useMemberDetail = (id: string) =>
  useQuery({
    queryKey: membersQueryKeys.detail(id),
    queryFn: () => getMemberDetailBundle(id),
    enabled: !!id,
  });
