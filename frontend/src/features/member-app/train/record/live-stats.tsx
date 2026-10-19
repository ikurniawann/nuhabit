import { useT } from "../../lib/i18n";
import type { ActivityType } from "../../lib/queries-train";
import { formatDistanceM, formatDuration, formatPace } from "../../ui";

/** The big clock while recording, with distance and pace for GPS activities. */
export function LiveClock({
  type,
  paused,
  elapsedSec,
  distanceM,
  avgPace,
  units,
}: {
  type: ActivityType | "HYROX";
  paused: boolean;
  elapsedSec: number;
  distanceM: number;
  avgPace: number | null;
  units: "METRIC" | "IMPERIAL";
}) {
  const t = useT();
  return (
    <div className="nh-card flex flex-col items-center gap-1 !py-8">
      <p className="nh-label !mb-0">{t("Time")}</p>
      <p className="nh-display text-7xl leading-none">
        {formatDuration(elapsedSec)}
      </p>
      {type !== "WORKOUT" ? (
        <div className="mt-4 flex gap-8 text-center">
          <div>
            <p className="nh-label !mb-0">{t("Distance")}</p>
            <p className="nh-display text-3xl">
              {formatDistanceM(distanceM, units)}
            </p>
          </div>
          <div>
            <p className="nh-label !mb-0">{t("Avg pace")}</p>
            <p className="nh-display text-3xl">
              {formatPace(avgPace, units)}
            </p>
          </div>
        </div>
      ) : null}
      {paused ? (
        <p className="mt-3 text-xs font-black tracking-widest text-nh-warn uppercase">
          {t("Paused")}
        </p>
      ) : null}
    </div>
  );
}

/** GPS signal state, accuracy and errors while recording. */
export function GpsStatus({
  paused,
  lastFixAt,
  clockNow,
  gpsAccuracyM,
  gpsError,
}: {
  paused: boolean;
  lastFixAt: number | null;
  clockNow: number;
  gpsAccuracyM: number | null;
  gpsError: string;
}) {
  const t = useT();
  return (
    <div className="nh-card !py-3 text-sm">
      <p className="font-bold">
        {t(paused ? "GPS paused" : !lastFixAt ? "Finding GPS signal…" : clockNow - lastFixAt > 15000 ? "GPS signal lost" : gpsAccuracyM !== null && gpsAccuracyM > 50 ? "GPS signal weak" : "GPS recording")}
      </p>
      {gpsAccuracyM !== null ? (
        <p className="text-xs text-nh-muted">{t("Location accuracy")}: ±{Math.round(gpsAccuracyM)} m</p>
      ) : null}
      {gpsAccuracyM !== null && gpsAccuracyM > 50 ? (
        <p className="text-xs text-nh-warn">{t("Move outdoors for a more accurate route.")}</p>
      ) : null}
      {gpsError ? <p className="mt-1 text-xs text-nh-danger">{t(gpsError)}</p> : null}
      <p className="mt-1 text-xs text-nh-muted">{t("Keep this page open while recording; background GPS depends on your browser.")}</p>
    </div>
  );
}
