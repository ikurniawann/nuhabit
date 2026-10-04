"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bike, Footprints, PersonStanding } from "lucide-react";
import { GeoMap } from "../components/geo-map";
import { RouteMap } from "../components/route-map";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { useHeatmap, useMyActivities, useUnits } from "../lib/queries-train";
import { Spinner, formatDayTime, formatDistanceM, formatDuration } from "../ui";
import { TotalsCard } from "./you-page";

const SPORT_META: Record<string, { label: string; icon: typeof Footprints }> = {
  RUN: { label: "Run", icon: Footprints },
  RIDE: { label: "Ride", icon: Bike },
  WALK: { label: "Walk", icon: PersonStanding },
};

export function HeatmapPage() {
  const router = useRouter();
  const t = useT();
  const units = useUnits();
  const { data, isLoading } = useHeatmap();
  const { data: mine } = useMyActivities();

  // Only GPS activities paint the map - the same set feeds the stats below.
  const gps = (mine ?? []).filter((a) => a.thumbnail.length > 1);
  const totalM = gps.reduce((sum, a) => sum + a.distanceM, 0);
  const totalSec = gps.reduce((sum, a) => sum + a.movingSec, 0);
  const bySport = Object.entries(SPORT_META)
    .map(([type, meta]) => {
      const list = gps.filter((a) => a.type === type);
      return {
        type,
        ...meta,
        count: list.length,
        distanceM: list.reduce((sum, a) => sum + a.distanceM, 0),
      };
    })
    .filter((row) => row.count > 0);

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm font-bold text-nh-muted"
      >
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <div>
        <h1 className="nh-display text-3xl">{t("Personal heatmap")}</h1>
        <p className="text-sm text-nh-muted">
          {t("Every GPS track you have recorded, on one map.")}
        </p>
      </div>
      {isLoading || !data ? (
        <Spinner label={t("Painting your tracks…")} />
      ) : data.tracks.length === 0 ? (
        <p className="nh-card text-sm text-nh-muted">
          {t("No GPS activities yet.")}
        </p>
      ) : (
        <GeoMap
          tracks={data.tracks.map((points) => ({
            points,
            opacity: 0.4,
            width: 3.5,
            markers: false,
          }))}
          height={380}
          showMe
        />
      )}

      {/* Coverage totals on the shared black card */}
      <TotalsCard
        cells={[
          { label: t("Tracks"), value: gps.length },
          { label: t("Painted"), value: `${(totalM / 1000).toFixed(0)} km` },
          { label: t("Moving"), value: formatDuration(totalSec) },
        ]}
      />

      {/* Split per sport */}
      {bySport.length > 0 ? (
        <section>
          <p className="mb-2 px-1 text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">
            {t("By sport")}
          </p>
          <div className="nh-card flex flex-col gap-3">
            {bySport.map(({ type, label, icon: Icon, count, distanceM }) => (
              <div key={type} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-extrabold">{t(label)}</span>
                    <span className="font-bold text-nh-muted">
                      {count} · {formatDistanceM(distanceM, units)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-nh-raised">
                    <div
                      className="h-full rounded-full bg-nh-forest"
                      style={{
                        width: `${totalM > 0 ? (distanceM / totalM) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* The tracks behind the paint */}
      {gps.length > 0 ? (
        <section>
          <p className="mb-2 px-1 text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">
            {t("Recent tracks")}
          </p>
          <div className="flex flex-col gap-2">
            {gps.slice(0, 5).map((a) => (
              <Link
                key={a.id}
                href={m(`/train/activities/${a.id}`)}
                className="nh-card flex items-center gap-3 !p-3"
              >
                <div className="h-14 w-20 shrink-0 overflow-hidden rounded-xl">
                  <RouteMap points={a.thumbnail} height={56} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">{a.title}</p>
                  <p className="text-xs text-nh-muted">
                    {formatDayTime(a.startedAt)} ·{" "}
                    {formatDistanceM(a.distanceM, units)} ·{" "}
                    {formatDuration(a.movingSec)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
