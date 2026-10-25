"use client";

import Link from "next/link";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { useParq } from "../lib/queries-health";
import { formatDay } from "../ui";

/** Profile card: PAR-Q status and the way to the health declaration. */
export function HealthCard() {
  const t = useT();
  const { data } = useParq();
  const last = data?.last;
  return (
    <Link href={m("/profile/health")} className="nh-card flex flex-col gap-2 text-sm">
      <p className="nh-label !mb-0">{t("Health declaration")}</p>
      <div className="flex justify-between gap-3">
        <span className="text-nh-muted">PAR-Q+</span>
        {!data ? null : !data.due && last ? (
          <span className="font-bold text-nh-ok">{t("Valid until {date}.", { date: formatDay(last.expires_at) })}</span>
        ) : (
          <span className="font-bold text-nh-warn">{last ? t("Renew now") : t("Not filled")} →</span>
        )}
      </div>
    </Link>
  );
}
