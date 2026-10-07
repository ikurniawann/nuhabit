"use client";

import type { ComponentType, ReactNode } from "react";

type PurchasingListSectionProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  toolbar?: ReactNode;
  children: ReactNode;
};

export function PurchasingListSection({
  icon: Icon,
  title,
  description,
  toolbar,
  children,
}: PurchasingListSectionProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
            {Icon ? <Icon className="h-5 w-5" /> : null}
          </span>
          <div>
            <h2 className="text-base font-semibold text-gray-950">{title}</h2>
            <p className="text-xs text-gray-500">{description}</p>
          </div>
        </div>
        {toolbar}
      </div>
      {children}
    </section>
  );
}
