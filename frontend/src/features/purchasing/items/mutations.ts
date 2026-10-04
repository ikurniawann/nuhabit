"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ItemsLookupType, ItemsLookupFormData } from "@/lib/purchasing/items-lookup";
import { saveItemsLookup, deleteItemsLookup } from "./api";
import { itemsQueryKeys } from "./query-keys";

export function useSaveItemsLookup(type: ItemsLookupType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, id }: { payload: ItemsLookupFormData; id?: string }) =>
      saveItemsLookup(type, payload, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: itemsQueryKeys.byType(type) }),
  });
}

export function useDeleteItemsLookup(type: ItemsLookupType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteItemsLookup(type, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: itemsQueryKeys.byType(type) }),
  });
}
