import { useT } from "../../lib/i18n";
import { formatDuration } from "../../ui";

/** The Lap button and the split chips recorded so far. */
export function LapBar({
  laps,
  paused,
  onLap,
}: {
  laps: number[];
  paused: boolean;
  onLap: () => void;
}) {
  const t = useT();
  return (
    <div className="nh-card flex items-center gap-3 !py-3">
      <button
        onClick={onLap}
        disabled={paused}
        className="nh-btn-ghost shrink-0 !px-5 !py-2.5 text-sm disabled:opacity-40"
      >
        {t("Lap")} {laps.length + 1}
      </button>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {laps.map((at, i) => (
          <span
            key={i}
            className="nh-chip shrink-0 bg-nh-raised text-nh-muted"
          >
            {i + 1} · {formatDuration(at - (laps[i - 1] ?? 0))}
          </span>
        ))}
        {laps.length === 0 ? (
          <span className="text-xs text-nh-muted">
            {t("Tap to mark a lap.")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
