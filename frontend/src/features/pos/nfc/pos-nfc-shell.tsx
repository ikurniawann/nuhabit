"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isPosPath } from "./resolve-topup-path";
import { PosNfcProvider } from "./pos-nfc-context";
import { PosNfcScanListener } from "./pos-nfc-scan-listener";

export function PosNfcShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (!isPosPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <PosNfcProvider>
      <PosNfcScanListener />
      {children}
    </PosNfcProvider>
  );
}
