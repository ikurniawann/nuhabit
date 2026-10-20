"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { canAct, hasAnyIamMenuPrefix } from "@/lib/iam/match";

type GrantedActions = Readonly<Record<string, readonly string[]>>;

type IamAccessValue = {
  grantedCodes: readonly string[];
  hasPrefix: (prefixes: readonly string[]) => boolean;
  /** Aksi menu (read/create/update/delete/read_own); true bila layout tidak mengirim data aksi. */
  can: (menus: string | readonly string[], action: string) => boolean;
};

const IamAccessContext = createContext<IamAccessValue>({
  grantedCodes: [],
  hasPrefix: () => false,
  // Tanpa provider tombol tidak disembunyikan; API Go tetap menolak.
  can: () => true,
});

export function IamAccessProvider({
  grantedCodes,
  grantedActions,
  children,
}: {
  grantedCodes: readonly string[];
  /** `{ [menuCode]: actions[] }` dari layout server; tanpa ini `can` selalu true. */
  grantedActions?: GrantedActions;
  children: ReactNode;
}) {
  const value = useMemo<IamAccessValue>(
    () => ({
      grantedCodes,
      hasPrefix: (prefixes) => hasAnyIamMenuPrefix(grantedCodes, prefixes),
      can: (menus, action) => (grantedActions ? canAct(grantedActions, menus, action) : true),
    }),
    [grantedCodes, grantedActions]
  );

  return <IamAccessContext.Provider value={value}>{children}</IamAccessContext.Provider>;
}

export function useIamAccess(): IamAccessValue {
  return useContext(IamAccessContext);
}

/**
 * True bila user punya `action` pada salah satu menu (kode exact atau
 * turunannya), aturan yang sama dengan guard API Go.
 */
export function useCan(menus: string | readonly string[], action: string): boolean {
  return useIamAccess().can(menus, action);
}
