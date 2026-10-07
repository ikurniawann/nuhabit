"use client";

import type { PipelineStage } from "@/types";
import {
  PIPELINE_STAGES,
  FUNNEL_ORDER,
  funnelIndex,
} from "@/lib/recruitment/status";

/**
 * Stepper progres funnel recruitment — dipakai di drawer pipeline dan
 * halaman detail kandidat. Klik tahap = pindahkan kandidat.
 */
export function StageStepper({
  status,
  onMove,
  size = "sm",
}: {
  status: PipelineStage;
  onMove: (s: PipelineStage) => void;
  size?: "sm" | "lg";
}) {
  const currentIdx = funnelIndex(status);
  const isParked = currentIdx === -1; // talent_pool / rejected

  const pill =
    size === "lg"
      ? "px-3.5 py-1.5 text-sm"
      : "px-2.5 py-1 text-[11px]";
  const connector = size === "lg" ? "w-6" : "w-4";

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {FUNNEL_ORDER.map((stageId, idx) => {
        const stage = PIPELINE_STAGES.find((s) => s.id === stageId)!;
        const isDone = !isParked && idx < currentIdx;
        const isCurrent = stageId === status;
        return (
          <div key={stageId} className="flex shrink-0 items-center gap-1">
            {idx > 0 && (
              <div
                className={`h-0.5 ${connector} ${isDone || isCurrent ? "bg-blue-400" : "bg-gray-200"}`}
              />
            )}
            <button
              onClick={() => onMove(stageId)}
              title={`Pindahkan ke ${stage.label}`}
              className={`rounded-full font-medium transition-colors ${pill} ${
                isCurrent
                  ? "bg-blue-600 text-white shadow-sm"
                  : isDone
                    ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {stage.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
