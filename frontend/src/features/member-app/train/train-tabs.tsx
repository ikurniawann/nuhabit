"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleDot, CirclePlay, Compass, Newspaper, User } from "lucide-react";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";

const TABS = [
  { to: "/train", label: "Feed", end: true, icon: Newspaper },
  { to: "/train/record", label: "Record", end: false, icon: CircleDot },
  { to: "/train/you", label: "You", end: false, icon: User },
  { to: "/train/explore", label: "Explore", end: false, icon: Compass },
  { to: "/train/tutorials", label: "Guides", end: false, icon: CirclePlay },
];

export function TrainTabs() {
  const t = useT();
  const pathname = usePathname();
  return (
    <div className="mb-4 flex gap-1 rounded-2xl bg-nh-cream p-1.5 shadow-[0_1px_2px_rgb(0_40_26/0.04),0_8px_24px_rgb(0_40_26/0.04)]">
      {TABS.map(({ to, label, end, icon: Icon }) => {
        const href = m(to);
        const isActive = end ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={to}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-2 transition-colors duration-200 ${
              isActive
                ? "nh-surface-ink text-white shadow-[0_6px_16px_rgb(0_40_26/0.25)]"
                : "text-nh-muted"
            }`}
          >
            <Icon
              size={15}
              strokeWidth={2.4}
              className={isActive ? "text-nh-lime" : undefined}
            />
            <span className="text-[10px] font-black tracking-wide uppercase">
              {t(label)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
