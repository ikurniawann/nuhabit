"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BRANCH_COOKIE } from "../lib/branch-cookie";
import CartPanel from "../panels/cart-panel";
import MembershipPanel from "../panels/membership-panel";
import TimetablePanel from "../panels/timetable-panel";
import TrialPanel from "../panels/trial-panel";

/** Props every slide-over panel receives. */
export interface PanelProps {
  branchSlug?: string;
  onClose(): void;
}

export type PanelKind = "timetable" | "trial" | "membership" | "cart";

export interface PanelEntry {
  title: string;
  Component: ComponentType<PanelProps>;
}

/** The four slide-overs of the public shell, keyed by what opens them. */
export const PANELS: Record<PanelKind, PanelEntry> = {
  timetable: { title: "Class timetable", Component: TimetablePanel },
  trial: { title: "Start a trial", Component: TrialPanel },
  membership: { title: "Membership", Component: MembershipPanel },
  cart: { title: "Cart", Component: CartPanel },
};

export { BRANCH_COOKIE };

/** The branch slug the visitor picked in the footer, from document.cookie. */
export function readBranchCookie(cookie: string): string | undefined {
  const match = cookie.split(/;\s*/).find((part) => part.startsWith(`${BRANCH_COOKIE}=`));
  const value = match ? decodeURIComponent(match.slice(BRANCH_COOKIE.length + 1)) : "";
  return value || undefined;
}

export function writeBranchCookie(slug: string) {
  document.cookie = `${BRANCH_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`;
}

export interface OpenPanel {
  kind: PanelKind;
  branchSlug?: string;
}

/** The panel to show: an explicit branch wins, else the remembered one. */
export function resolvePanel(kind: PanelKind, branchSlug: string | undefined, cookie: string): OpenPanel {
  return { kind, branchSlug: branchSlug ?? readBranchCookie(cookie) };
}

interface PanelsContextValue {
  open(kind: PanelKind, branchSlug?: string): void;
  close(): void;
  current: OpenPanel | null;
}

const PanelsContext = createContext<PanelsContextValue | null>(null);

export function SitePanelsProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<OpenPanel | null>(null);
  const open = useCallback((kind: PanelKind, branchSlug?: string) => {
    setCurrent(resolvePanel(kind, branchSlug, typeof document === "undefined" ? "" : document.cookie));
  }, []);
  const close = useCallback(() => setCurrent(null), []);
  const value = useMemo(() => ({ open, close, current }), [open, close, current]);
  return (
    <PanelsContext.Provider value={value}>
      {children}
      <SitePanelHost />
    </PanelsContext.Provider>
  );
}

export function useSitePanels(): PanelsContextValue {
  const ctx = useContext(PanelsContext);
  if (!ctx) throw new Error("useSitePanels needs SitePanelsProvider");
  return ctx;
}

/** Renders the open panel in a Sheet (focus trap and Esc come from Base UI). */
function SitePanelHost() {
  const { current, close } = useSitePanels();
  const entry = current ? PANELS[current.kind] : null;
  return (
    <Sheet open={current !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="sm:max-w-md" aria-describedby={undefined}>
        {entry && current ? (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle className="text-lg">{entry.title}</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <entry.Component branchSlug={current.branchSlug} onClose={close} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
