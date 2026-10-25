"use client";

import { HeartPulse } from "lucide-react";
import Link from "next/link";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { parqBanner } from "../lib/parq";
import { useParq } from "../lib/queries-health";

/** Home banner when the PAR-Q declaration is missing, expired or out of date. */
export function HealthBanner() {
  const t = useT();
  const { data } = useParq();
  const kind = parqBanner(data);
  if (!kind) return null;
  return (
    <Link href={m("/profile/health")} className="nh-card flex items-center gap-3 !p-4 active:scale-[0.98]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nh-forest/10 text-nh-forest">
        <HeartPulse size={20} />
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-bold">
          {kind === "fill" ? t("Fill in your health declaration") : t("Time to renew your health declaration")}
        </span>
        <span className="block text-nh-muted">
          {kind === "fill"
            ? t("Seven quick questions so your coach can train you safely.")
            : t("Your PAR-Q is older than 12 months. Answer again before your next class.")}
        </span>
      </span>
      <span className="text-sm font-bold text-nh-forest">→</span>
    </Link>
  );
}
