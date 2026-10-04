"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, MapPin } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "../lib/i18n";
import { api, useInvalidateAll } from "../lib/queries-workout";
import { Spinner, StatusBadge, formatDayTime, formatDuration } from "../ui";
import { RegisterSheet } from "./races-page";

export function RaceDetailPage() {
  const { raceId = "" } = useParams<{ raceId: string }>();
  const router = useRouter();
  const t = useT();
  const invalidate = useInvalidateAll();
  const [registerOpen, setRegisterOpen] = useState(false);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["member-app", "race", raceId],
    queryFn: () => api.races.get(raceId),
  });

  if (isLoading || !data) return <Spinner label={t("Loading race…")} />;
  const { view, myRace, daysToRace } = data;
  const e = view.event;
  const upcoming = daysToRace > 0 && e.status !== "COMPLETED" && e.status !== "CANCELLED";

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>

      <div className="nh-card relative overflow-hidden !border-0 !p-0 text-white">
        {e.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.imageUrl} alt="" className="h-56 w-full object-cover" />
        ) : (
          <div className="nh-surface-ink h-56 w-full" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/10" />
        <div className="absolute inset-x-0 bottom-0 p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">{formatDayTime(e.startsAt)}</p>
          <p className="nh-display mt-0.5 text-4xl leading-tight">{e.name}</p>
          <p className="mt-1 flex items-center gap-1 text-sm font-bold text-white/70">
            <MapPin size={13} /> {e.venue} · {e.city}, {e.country}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={e.status} />
            {upcoming ? (
              <span className="nh-chip bg-white/15 text-white backdrop-blur">
                {daysToRace} {t("days away")}
              </span>
            ) : null}
            <span className="nh-chip bg-white/15 text-white backdrop-blur">
              {view.participantCount} {t("from this studio")}
            </span>
          </div>
        </div>
      </div>

      {myRace ? (
        <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
          <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/50">{t("You're registered")}</p>
            <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-white/50">{t("Division")}</p>
                <p className="font-extrabold">{myRace.userRace.division.replaceAll("_", " ")}</p>
              </div>
              <div>
                <p className="text-white/50">{t("Goal")}</p>
                <p className="nh-display text-xl">
                  {myRace.userRace.goalSec ? formatDuration(myRace.userRace.goalSec) : "-"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-white/50">
              {t("Train with full simulations in Record - your readiness score lives on the Races tab.")}
            </p>
          </div>
        </div>
      ) : upcoming ? (
        <button className="nh-btn-brand" onClick={() => setRegisterOpen(true)}>
          {t("Add to my races")}
        </button>
      ) : null}

      <a
        href={e.registrationUrl}
        target="_blank"
        rel="noreferrer"
        className="nh-btn-ghost flex items-center justify-center gap-2"
      >
        {t("Official registration")} <ExternalLink size={15} />
      </a>

      {registerOpen ? (
        <RegisterSheet
          view={view}
          onClose={() => setRegisterOpen(false)}
          onDone={() => {
            setRegisterOpen(false);
            invalidate();
            void refetch();
          }}
        />
      ) : null}
    </div>
  );
}
