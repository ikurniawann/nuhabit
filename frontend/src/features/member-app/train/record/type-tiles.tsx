import { useT } from "../../lib/i18n";
import type { ActivityType } from "../../lib/queries-train";
import { TYPE_TILES } from "./constants";

/** The activity type row on the setup screen. */
export function TypeTiles({
  type,
  onSelect,
}: {
  type: ActivityType | "HYROX";
  onSelect: (type: ActivityType | "HYROX") => void;
}) {
  const t = useT();
  return (
    <div>
      <p className="nh-label">{t("Activity type")}</p>
      <div className="-mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1">
        {TYPE_TILES.map(({ id, label, hint, icon: Icon }) => {
          const selected = type === id;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className={`flex min-w-[104px] shrink-0 snap-start flex-col items-start gap-2.5 rounded-2xl p-3.5 text-left transition active:scale-[0.97] ${
                selected
                  ? "nh-surface-ink text-white shadow-[0_10px_26px_rgb(0_40_26/0.3)]"
                  : "nh-card !p-3.5"
              }`}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full ${
                  selected
                    ? "nh-surface-brand text-nh-ink"
                    : "bg-nh-ink-soft text-white"
                }`}
              >
                <Icon size={17} strokeWidth={2.2} />
              </span>
              <span>
                <span className="block text-sm leading-tight font-extrabold">
                  {t(label)}
                </span>
                <span
                  className={`block text-[11px] font-semibold ${selected ? "text-white/55" : "text-nh-muted"}`}
                >
                  {t(hint)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
