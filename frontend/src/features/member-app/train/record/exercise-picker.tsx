import { useState } from "react";
import { useT } from "../../lib/i18n";
import { EXERCISE_LIBRARY } from "./strength";
import { BottomSheet } from "../../components/bottom-sheet";

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
    <BottomSheet title={t("Add exercise")} onClose={onClose}>
      <input
        autoFocus
        className="nh-input mb-3"
        aria-label={t("Search exercises…")}
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
    </BottomSheet>
  );
}
