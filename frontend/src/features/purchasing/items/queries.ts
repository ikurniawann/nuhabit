"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ItemsLookupType } from "@/lib/purchasing/items-lookup";
import { listItemsLookup } from "./api";
import { itemsQueryKeys } from "./query-keys";

export const useItemsLookupList = (type: ItemsLookupType, search: string) =>
  useQuery({
    queryKey: itemsQueryKeys.list(type, search),
    queryFn: () => listItemsLookup(type, search || undefined),
    placeholderData: keepPreviousData,
  });
