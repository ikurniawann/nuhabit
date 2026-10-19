import { Dumbbell, X } from "lucide-react";
import { useT } from "../../lib/i18n";
import type { StrengthExercise } from "./strength";

/** The setup card that lists the exercises picked for a strength workout. */
export function WorkoutPlan({
  exercises,
  onAdd,
  onRemove,
}: {
  exercises: StrengthExercise[];
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const t = useT();
  return (
    <div className="nh-card">
      <div className="mb-2 flex items-center justify-between">
        <p className="nh-label !mb-0">{t("Your workout")}</p>
        <button
          className="text-sm font-bold text-nh-forest"
          onClick={onAdd}
        >
          {t("+ Add exercise")}
        </button>
      </div>
      {exercises.length === 0 ? (
        <p className="text-sm text-nh-muted">
          {t(
            "Build it like the gym log: add exercises, then track sets, kg and reps while you train.",
          )}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-nh-line">
          {exercises.map((ex, i) => (
            <div
              key={ex.name}
              className="flex items-center gap-3 py-2.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
                <Dumbbell size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">
                  {ex.name}
                </p>
                <p className="text-xs text-nh-muted">
                  {ex.muscle} · {ex.sets.length} {t("sets")}
                </p>
              </div>
              <button
                className="text-nh-muted"
                aria-label={`${t("Remove")} ${ex.name}`}
                onClick={() => onRemove(i)}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
