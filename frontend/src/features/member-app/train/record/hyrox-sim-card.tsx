import { Flame, Play } from "lucide-react";
import type { Division } from "@/lib/gym/hyrox";
import { useT } from "../../lib/i18n";
import { DIVISIONS } from "./constants";

/** The setup card for a guided HYROX simulation: division picker and start button. */
export function HyroxSimCard({
  division,
  onDivision,
  simError,
  simBusy,
  onStart,
}: {
  division: Division;
  onDivision: (division: Division) => void;
  simError: string;
  simBusy: boolean;
  onStart: () => void;
}) {
  const t = useT();
  return (
    <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
      <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
      <div className="relative">
        <p className="flex items-center gap-2 text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">
          <Flame size={13} className="text-nh-lime" />{" "}
          {t("HYROX simulation")}
        </p>
        <p className="nh-display mt-1 text-2xl leading-tight">
          {t("8 runs. 8 stations. Race pace.")}
        </p>
        <p className="mt-1.5 text-sm text-white/60">
          {t(
            "Guided station by station with your division loads - timed like race day.",
          )}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {DIVISIONS.map((d) => (
            <button
              key={d.id}
              onClick={() => onDivision(d.id)}
              className={`rounded-xl px-3 py-2 text-xs font-black uppercase transition ${
                division === d.id
                  ? "bg-white text-nh-ink"
                  : "bg-white/10 text-white/60 hover:bg-white/15"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        {simError ? (
          <p className="mt-3 text-sm font-bold text-nh-lime">
            {simError}
          </p>
        ) : null}
        <button
          onClick={onStart}
          disabled={simBusy}
          className="nh-btn-brand mt-4 flex w-full items-center justify-center gap-2 disabled:opacity-40"
        >
          <Play size={18} fill="currentColor" />
          {simBusy ? t("Preparing…") : t("Start simulation")}
        </button>
        <p className="mt-2.5 text-center text-xs text-white/40">
          {t(
            "Finishing saves it to your training feed and race readiness.",
          )}
        </p>
      </div>
    </div>
  );
}
