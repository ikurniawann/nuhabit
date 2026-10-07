"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listWallpapers } from "./api";
import { wallpapersQueryKeys } from "./query-keys";

export const useWallpapersList = () =>
  useQuery({
    queryKey: wallpapersQueryKeys.list(),
    queryFn: () => listWallpapers(),
    placeholderData: keepPreviousData,
  });
