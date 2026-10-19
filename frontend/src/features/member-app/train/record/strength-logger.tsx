import type { Dispatch, SetStateAction } from "react";
import { Check } from "lucide-react";
import { useT } from "../../lib/i18n";
import type { StrengthExercise, StrengthSet } from "./strength";

/** The live set log for a strength workout: kg, reps and done per set. */
export function StrengthLogger({
  exercises,
  setExercises,
}: {
  exercises: StrengthExercise[];
  setExercises: Dispatch<SetStateAction<StrengthExercise[]>>;
}) {
  const t = useT();
  const updateSet = (ei: number, si: number, patch: Partial<StrengthSet>) =>
    setExercises((prev) =>
      prev.map((x, j) =>
        j === ei
          ? {
              ...x,
              sets: x.sets.map((ss, k) =>
                k === si ? { ...ss, ...patch } : ss,
              ),
            }
          : x,
      ),
    );

  return (
    <div className="flex flex-col gap-3">
      {exercises.map((ex, ei) => (
        <div key={ex.name} className="nh-card !py-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-extrabold">{ex.name}</p>
            <span className="nh-chip bg-nh-raised text-nh-muted">
              {ex.muscle}
            </span>
          </div>
          <div className="mt-2.5 flex flex-col gap-1.5">
            <div className="grid grid-cols-[2rem_1fr_1fr_2.5rem] gap-2 text-[10px] font-extrabold tracking-wider text-nh-muted uppercase">
              <span>{t("Set")}</span>
              <span>kg</span>
              <span>{t("Reps")}</span>
              <span />
            </div>
            {ex.sets.map((set, si) => (
              <div
                key={si}
                className={`grid grid-cols-[2rem_1fr_1fr_2.5rem] items-center gap-2 rounded-xl px-0.5 py-0.5 ${
                  set.done ? "bg-nh-ok/10" : ""
                }`}
              >
                <span className="text-center text-sm font-black text-nh-muted">
                  {si + 1}
                </span>
                <input
                  inputMode="decimal"
                  placeholder="-"
                  value={set.kg}
                  onChange={(e) =>
                    updateSet(ei, si, { kg: e.target.value })
                  }
                  className="nh-input !rounded-lg !px-2.5 !py-1.5 text-center text-sm"
                />
                <input
                  inputMode="numeric"
                  placeholder="-"
                  value={set.reps}
                  onChange={(e) =>
                    updateSet(ei, si, { reps: e.target.value })
                  }
                  className="nh-input !rounded-lg !px-2.5 !py-1.5 text-center text-sm"
                />
                <button
                  aria-label={t("Set done")}
                  onClick={() => updateSet(ei, si, { done: !set.done })}
                  className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full ${
                    set.done
                      ? "bg-nh-ok text-white"
                      : "bg-nh-raised text-nh-muted"
                  }`}
                >
                  <Check size={14} />
                </button>
              </div>
            ))}
            <button
              className="mt-1 self-start text-xs font-bold text-nh-forest"
              onClick={() =>
                setExercises((prev) =>
                  prev.map((x, j) =>
                    j === ei
                      ? {
                          ...x,
                          sets: [
                            ...x.sets,
                            { kg: "", reps: "", done: false },
                          ],
                        }
                      : x,
                  ),
                )
              }
            >
              {t("+ Add set")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
