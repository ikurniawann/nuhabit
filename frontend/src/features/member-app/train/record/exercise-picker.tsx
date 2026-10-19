import { useState } from "react";
import { useT } from "../../lib/i18n";
import { EXERCISE_LIBRARY } from "./strength";

/** Hevy-style exercise picker, grouped by muscle. */
export function ExercisePicker({
  chosen,
  onPick,
  onClose,
}: {
  chosen: string[];
  onPick: (name: string, muscle: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  return (
    <div
      className="nh-sheet-backdrop fixed inset-0 z-40 flex items-end justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="nh-sheet-panel flex max-h-[80dvh] w-full max-w-md flex-col rounded-t-3xl bg-nh-cream p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="nh-display mb-3 text-xl">{t("Add exercise")}</h2>
        <input
          autoFocus
          className="nh-input mb-3"
          placeholder={t("Search exercises…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex-1 overflow-y-auto">
          {Object.entries(EXERCISE_LIBRARY).map(([muscle, names]) => {
            const visible = names.filter(
              (n) =>
                !q ||
                n.toLowerCase().includes(q) ||
                muscle.toLowerCase().includes(q),
            );
            if (visible.length === 0) return null;
            return (
              <div key={muscle} className="mb-3">
                <p className="mb-1.5 text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">
                  {muscle}
                </p>
                <div className="flex flex-col gap-1">
                  {visible.map((name) => {
                    const taken = chosen.includes(name);
                    return (
                      <button
                        key={name}
                        disabled={taken}
                        onClick={() => onPick(name, muscle)}
                        className="flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-bold active:bg-nh-raised disabled:opacity-40"
                      >
                        {name}
                        {taken ? (
                          <span className="text-xs font-bold text-nh-ok">
                            {t("Added")}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
