"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbNavProps {
  items: BreadcrumbItem[];
}

export function BreadcrumbNav({ items }: BreadcrumbNavProps) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      {items.map((crumb, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={crumb.label} className="flex items-center gap-1">
            {!isLast && crumb.href ? (
              <Link
                href={crumb.href}
                className="text-gray-500 hover:text-gray-900 transition-colors"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className={isLast ? "text-gray-900 font-medium" : "text-gray-400"}>
                {crumb.label}
              </span>
            )}
            {!isLast && (
              <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
            )}
          </span>
        );
      })}
    </nav>
  );
}
