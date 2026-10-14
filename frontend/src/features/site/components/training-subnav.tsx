"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { TRAINING_NAV } from "../lib/training";
import { Container } from "./site-section";

/** Tabs across the training pages; scrolls sideways on a phone. */
export function TrainingSubnav() {
  const pathname = usePathname() ?? "";
  return (
    <Container className="pt-6 md:pt-8">
      <nav aria-label="Training pages" className="no-scrollbar flex overflow-x-auto border border-border">
        {TRAINING_NAV.map((item) => {
          const active = item.href === "/training" ? pathname === "/training" || pathname.startsWith("/training/classes") : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 border-r border-border px-5 py-3 text-xs font-bold tracking-wider whitespace-nowrap uppercase transition-colors last:border-r-0",
                active ? "bg-ink text-on-ink" : "text-body hover:bg-surface-2",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </Container>
  );
}
