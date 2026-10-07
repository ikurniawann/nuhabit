"use client";

import type { ReactNode } from "react";
import type { BranchSummary, SocialContent } from "../types";
import { SitePanelsProvider } from "./panels";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** The public site's chrome: header, slide-over panels and footer. */
export function SiteShell({
  branches,
  social,
  memberLinked,
  children,
}: {
  branches: BranchSummary[];
  social: SocialContent;
  memberLinked: boolean;
  children: ReactNode;
}) {
  return (
    <SitePanelsProvider>
      <div lang="en" className="flex min-h-dvh flex-col bg-background text-foreground">
        <SiteHeader memberLinked={memberLinked} />
        <main id="content" className="flex-1">
          {children}
        </main>
        <SiteFooter branches={branches} social={social} />
      </div>
    </SitePanelsProvider>
  );
}
