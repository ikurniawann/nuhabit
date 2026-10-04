"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { menusQueryKeys } from "./query-keys";
import { createMenu, updateMenu, deleteMenu } from "./api";
import type {
  CreateMenuPayload,
  UpdateMenuPayload,
} from "@/lib/iam/menu-types";

function useInvalidateMenus() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: menusQueryKeys.all });
}

export function useCreateMenu() {
  const invalidate = useInvalidateMenus();
  return useMutation({
    mutationFn: (payload: CreateMenuPayload) => createMenu(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateMenu() {
  const invalidate = useInvalidateMenus();
  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateMenuPayload & { id: string }) =>
      updateMenu(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteMenu() {
  const invalidate = useInvalidateMenus();
  return useMutation({
    mutationFn: (id: string) => deleteMenu(id),
    onSuccess: invalidate,
  });
}
