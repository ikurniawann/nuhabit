"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listBadges } from "./api";
import { badgesQueryKeys } from "./query-keys";

export const useBadgesList = () =>
  useQuery({
    queryKey: badgesQueryKeys.list(),
    queryFn: () => listBadges(),
    placeholderData: keepPreviousData,
  });
