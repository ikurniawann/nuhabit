"use client";

import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useSitePanels, type PanelKind } from "../shell/panels";

/** A button that opens one of the shell's slide-over panels. */
export function PanelButton({
  panel,
  branchSlug,
  children,
  ...props
}: Omit<ButtonProps, "onClick"> & { panel: PanelKind; branchSlug?: string; children: ReactNode }) {
  const panels = useSitePanels();
  return (
    <Button {...props} onClick={() => panels.open(panel, branchSlug)}>
      {children}
    </Button>
  );
}
