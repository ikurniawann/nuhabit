"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listAvatars } from "./api";
import { avatarsQueryKeys } from "./query-keys";
import type { AvatarsListParams } from "./types";

export const useAvatarsList = (params: AvatarsListParams) =>
  useQuery({
    queryKey: avatarsQueryKeys.list(params),
    queryFn: () => listAvatars(params),
    placeholderData: keepPreviousData,
  });
