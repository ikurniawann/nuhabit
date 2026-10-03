"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { ChevronRight, Home } from "lucide-react";
import { buildNavBreadcrumbs } from "@/lib/iam/nav-breadcrumbs";
import { useNavFrom } from "@/lib/iam/use-nav-from";
import type { NavItem } from "@/lib/iam/types";

interface DashboardBreadcrumbsProps {
  navItems: NavItem[];
  className?: string;
}

export function DashboardBreadcrumbs({ navItems, className = "" }: DashboardBreadcrumbsProps) {
  const pathname = usePathname();
  const navFrom = useNavFrom();
  const items = useMemo(
    () => buildNavBreadcrumbs(navItems, pathname, navFrom),
    [navItems, pathname, navFrom]
  );

  // A single crumb repeats the header title.
  if (items.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className={`min-h-8 min-w-0 items-center ${className}`}
    >
      <ol className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {!isLast && crumb.href ? (
                <Link
                  href={crumb.href}
                  className="flex min-w-0 items-center gap-1.5 truncate hover:text-foreground hover:underline"
                >
                  {index === 0 && <Home className="size-3.5 shrink-0" aria-hidden />}
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={`truncate ${isLast ? "font-medium text-foreground" : ""}`}
                  aria-current={isLast ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              )}
              {!isLast && <ChevronRight className="size-3.5 shrink-0 text-silver" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
