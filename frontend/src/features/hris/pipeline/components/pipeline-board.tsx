"use client";

import type { CSSProperties } from "react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Clock, Users } from "lucide-react";
import type { Candidate, PipelineStage } from "@/types";
import { FUNNEL_ORDER, PIPELINE_STAGES } from "@/lib/recruitment/status";
import {
  daysInStage,
  funnelSegmentWidth,
  funnelTotal,
  initials,
  stageAgeTone,
  stageDotClass,
} from "@/lib/recruitment/pipeline-board";

export type PipelineCandidate = Candidate & {
  brands?: { name: string } | null;
  positions?: { title: string } | null;
};

const AGE_BORDER = { stale: "border-red-300", aging: "border-amber-300", fresh: "" } as const;
const AGE_TEXT = {
  stale: "font-medium text-red-500",
  aging: "font-medium text-amber-500",
  fresh: "text-gray-400",
} as const;

/** Bar proporsi kandidat per tahap funnel + legenda semua tahap. */
export function FunnelProgress({ byStage }: { byStage: Map<PipelineStage, PipelineCandidate[]> }) {
  const total = funnelTotal(byStage);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Users className="size-4 text-gray-400" />
          {total} kandidat di funnel aktif
        </span>
      </div>
      <div className="flex w-full overflow-hidden rounded-full">
        {FUNNEL_ORDER.map((stageId) => {
          const stage = PIPELINE_STAGES.find((s) => s.id === stageId)!;
          const count = byStage.get(stageId)?.length ?? 0;
          return (
            <div
              key={stageId}
              title={`${stage.label}: ${count}`}
              style={{ width: `${funnelSegmentWidth(count, total)}%` }}
              className={`h-2.5 ${count > 0 ? stageDotClass(stage.badge) : "bg-gray-100"}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {PIPELINE_STAGES.map((stage) => (
          <span key={stage.id} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`inline-block size-2 rounded-full ${stageDotClass(stage.badge)}`} />
            {stage.label} <b className="text-gray-700">{byStage.get(stage.id)?.length ?? 0}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function CandidateCard({ candidate, dragging }: { candidate: PipelineCandidate; dragging: boolean }) {
  const days = daysInStage(candidate.updated_at);
  const tone = stageAgeTone(days);
  return (
    <div
      className={`cursor-pointer rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${
        dragging ? "rotate-1 shadow-lg" : ""
      } ${AGE_BORDER[tone]}`}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
          {initials(candidate.full_name)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-900">{candidate.full_name}</div>
          <div className="truncate text-xs text-gray-500">{candidate.positions?.title ?? "—"}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="truncate text-[11px] text-gray-400">{candidate.brands?.name ?? ""}</span>
        <span className={`flex items-center gap-1 text-[11px] ${AGE_TEXT[tone]}`}>
          <Clock className="size-3" /> {days}h
        </span>
      </div>
    </div>
  );
}

/** Kanban drag & drop: lepas kartu di kolom lain = pindah tahap. */
export function PipelineKanban({
  byStage,
  onMove,
  onSelect,
}: {
  byStage: Map<PipelineStage, PipelineCandidate[]>;
  onMove: (id: string, status: PipelineStage) => void;
  onSelect: (id: string) => void;
}) {
  const handleDragEnd = ({ destination, source, draggableId }: DropResult) => {
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    onMove(draggableId, destination.droppableId as PipelineStage);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {PIPELINE_STAGES.map((stage) => {
          const stageCandidates = byStage.get(stage.id) ?? [];
          return (
            <Droppable droppableId={stage.id} key={stage.id}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`flex w-[250px] flex-shrink-0 flex-col rounded-xl border-2 sm:w-[270px] ${stage.color} ${
                    snapshot.isDraggingOver ? "ring-2 ring-blue-400 ring-offset-1" : ""
                  }`}
                >
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm font-semibold text-gray-800">{stage.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${stage.badge}`}>
                      {stageCandidates.length}
                    </span>
                  </div>
                  <div className="flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-2">
                    {stageCandidates.map((c, index) => (
                      <Draggable draggableId={c.id} index={index} key={c.id}>
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            style={dragProvided.draggableProps.style as CSSProperties | undefined}
                            onClick={() => onSelect(c.id)}
                          >
                            <CandidateCard candidate={c} dragging={dragSnapshot.isDragging} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {stageCandidates.length === 0 && (
                      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-300 py-6 text-xs text-gray-400">
                        Kosong
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Droppable>
          );
        })}
      </div>
    </DragDropContext>
  );
}
