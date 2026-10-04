"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { hasAnyIamMenuPrefix } from "@/lib/iam/match";

type IamAccessValue = {
  grantedCodes: readonly string[];
  hasPrefix: (prefixes: readonly string[]) => boolean;
};

const IamAccessContext = createContext<IamAccessValue>({
  grantedCodes: [],
  hasPrefix: () => false,
});

export function IamAccessProvider({
  grantedCodes,
  children,
}: {
  grantedCodes: readonly string[];
  children: ReactNode;
}) {
  const value = useMemo<IamAccessValue>(
    () => ({
      grantedCodes,
      hasPrefix: (prefixes) => hasAnyIamMenuPrefix(grantedCodes, prefixes),
    }),
    [grantedCodes]
  );

  return <IamAccessContext.Provider value={value}>{children}</IamAccessContext.Provider>;
}

export function useIamAccess(): IamAccessValue {
  return useContext(IamAccessContext);
}
