"use client";

import { useT } from "../lib/i18n";
import { useMyVisits } from "../lib/queries-home";
import { EmptyState, Spinner, StatusBadge, formatDayTime, gateReasonLabel } from "../ui";

export function VisitsPage() {
  const t = useT();
  const { data: visits, isLoading } = useMyVisits();
  if (isLoading) return <Spinner label={t("Loading visits…")} />;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl font-black">{t("Visit history")}</h1>
      {!visits || visits.length === 0 ? (
        <EmptyState title={t("No visits yet")} hint={t("Your gate check-ins will appear here.")} />
      ) : (
        <div className="flex flex-col gap-2">
          {visits.map((v) => (
            <div key={v.log.id} className="nh-card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-bold">{v.gateName}</p>
                <p className="text-sm text-nh-muted">{formatDayTime(v.log.createdAt)}</p>
                {v.log.reasonCode ? (
                  <p className="text-xs font-bold text-nh-danger">{t(gateReasonLabel(v.log.reasonCode))}</p>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={v.log.result} />
                <span className="text-xs font-black text-nh-muted">
                  {v.log.creditDelta !== 0 ? `${v.log.creditDelta} cr` : "-"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
