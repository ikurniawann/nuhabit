"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SELECT } from "@/features/gym/shared";
import { cn } from "@/lib/utils";
import { actionForColumn, groupByStatus } from "../grouping";
import { useOccurrenceAction } from "../mutations";
import { useTaskItems, useTaskMeta } from "../queries";
import { STATUS_LABEL, STATUS_ORDER, type OccurrenceStatus, type TaskItem, type TaskView } from "../types";
import { MonitorPanel } from "./monitor-panel";
import { PriorityBadge, TaskMetaLine } from "./task-badges";
import { TaskDetailSheet } from "./task-detail-sheet";
import { TaskFormDialog } from "./task-form-dialog";

const VIEWS: { value: TaskView; label: string }[] = [
  { value: "today", label: "Hari ini" },
  { value: "week", label: "Minggu ini" },
  { value: "month", label: "Bulan ini" },
];

const COLUMN_TONE: Record<OccurrenceStatus, string> = {
  pending: "text-foreground",
  in_progress: "text-warning",
  done: "text-info",
  approved: "text-success",
  rejected: "text-danger",
};

/**
 * Papan tugas departemen: kolom per status, geser kartu untuk mulai,
 * menandai selesai, menyetujui, menolak atau membuka lagi (mouse, sentuh,
 * atau Spasi + panah). Tab Pemantauan merangkum per departemen dan per
 * penanggung jawab. Manajer dengan tasks.team (atau HRD) memilih
 * departemen mana saja; kepala departemen melihat departemennya.
 */
export function TeamBoardPage() {
  const meta = useTaskMeta();
  const [chosenDepartment, setDepartment] = useState("");
  const [view, setView] = useState<TaskView>("week");
  const [tab, setTab] = useState<"board" | "monitor">("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const scope = meta.data?.team_scope ?? "none";
  const departments = meta.data?.departments ?? [];
  const department = chosenDepartment || departments[0]?.id || "";
  const month = (meta.data?.today ?? "").slice(0, 7);

  const enabled = scope !== "none" && !!department;
  const items = useTaskItems({ scope: "team", view, department_id: department }, enabled && tab === "board");
  const act = useOccurrenceAction();
  const columns = useMemo(() => groupByStatus(items.data ?? []), [items.data]);

  const onDragEnd = (result: DropResult) => {
    const { destination, draggableId } = result;
    if (!destination) return;
    const item = (items.data ?? []).find((t) => t.occurrence_id === draggableId);
    if (!item) return;
    const action = actionForColumn(destination.droppableId as OccurrenceStatus, item);
    if (!action) return;
    if ((action === "approve" || action === "reject") && !item.can_review) {
      toast.error("Hanya Head Division departemen ini yang bisa mereview");
      return;
    }
    act.mutate({ id: draggableId, body: action === "reject" ? { action, notes: null } : { action } });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Tugas"
        title="Papan Tim"
        description="Task departemen per status. Geser kartu untuk memindahkan, klik untuk membuka."
        actions={
          <>
            <Link href="/dashboard/tasks" className="text-sm text-brand-text underline-offset-4 hover:underline">
              Tugas saya
            </Link>
            <Button onClick={() => setCreating(true)} disabled={!enabled || !meta.data}>
              <Plus /> Task baru
            </Button>
          </>
        }
      />

      {meta.isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Memuat…</p>
      ) : scope === "none" ? (
        <p className="rounded-2xl bg-surface px-5 py-10 text-center text-sm text-muted-foreground">
          Papan tim hanya untuk kepala departemen dan manajer. Daftar Anda sendiri ada di{" "}
          <Link href="/dashboard/tasks" className="text-brand-text underline">
            Tugas Saya
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Departemen</span>
              <select className={cn(SELECT, "w-auto min-w-48")} value={department} onChange={(e) => setDepartment(e.target.value)}>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <Tabs value={tab} onValueChange={(v) => setTab(v as "board" | "monitor")}>
              <TabsList aria-label="Tampilan">
                <TabsTrigger value="board">Papan</TabsTrigger>
                <TabsTrigger value="monitor">Pemantauan</TabsTrigger>
              </TabsList>
            </Tabs>
            {tab === "board" && (
              <Tabs value={view} onValueChange={(v) => setView(v as TaskView)}>
                <TabsList aria-label="Rentang waktu">
                  {VIEWS.map((v) => (
                    <TabsTrigger key={v.value} value={v.value}>
                      {v.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
          </div>

          {tab === "monitor" ? (
            <MonitorPanel month={month} departmentId={department} onOpen={setOpenId} />
          ) : items.error ? (
            <p className="py-10 text-center text-sm text-danger">{items.error.message}</p>
          ) : (
            <DragDropContext onDragEnd={onDragEnd}>
              <ScrollRegion label="Papan tugas tim" className="flex gap-3 overflow-x-auto pb-4">
                {STATUS_ORDER.map((status) => (
                  <section key={status} aria-labelledby={`col-${status}`} className="flex w-72 shrink-0 flex-col rounded-2xl bg-surface">
                    <h2 id={`col-${status}`} className={cn("px-4 pb-1 pt-3 text-sm font-semibold", COLUMN_TONE[status])}>
                      {STATUS_LABEL[status]} <span className="font-normal text-muted-foreground">· {columns[status].length}</span>
                    </h2>
                    <Droppable droppableId={status}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={cn("flex min-h-32 flex-1 flex-col gap-2 px-3 pb-3 transition", snapshot.isDraggingOver && "bg-surface-2")}
                        >
                          {columns[status].map((item, index) => (
                            <Draggable key={item.occurrence_id} draggableId={item.occurrence_id} index={index}>
                              {(drag, dragSnapshot) => (
                                // The drag handle is already a focusable button (dnd sets
                                // role and tabIndex), so it opens the card too; a nested
                                // button would fail axe's nested-interactive rule.
                                <div
                                  ref={drag.innerRef}
                                  {...drag.draggableProps}
                                  {...drag.dragHandleProps}
                                  style={drag.draggableProps.style as CSSProperties}
                                  onClick={() => setOpenId(item.occurrence_id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      setOpenId(item.occurrence_id);
                                    }
                                  }}
                                  className={cn(
                                    "cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-forest/40",
                                    dragSnapshot.isDragging && "rotate-1 opacity-90 shadow-lg"
                                  )}
                                >
                                  <TaskCard item={item} />
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </section>
                ))}
              </ScrollRegion>
            </DragDropContext>
          )}
        </>
      )}

      {creating && meta.data && <TaskFormDialog meta={meta.data} departmentId={department} onClose={() => setCreating(false)} />}
      <TaskDetailSheet occurrenceId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** Isi kartu papan; interaksinya ada di pembungkus drag handle. */
function TaskCard({ item }: { item: TaskItem }) {
  return (
    <div className="w-full rounded-xl border border-border bg-card p-3 text-left shadow-sm transition hover:border-forest/40">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
        {item.title}
        <PriorityBadge priority={item.priority} />
      </p>
      <div className="mt-1.5">
        <TaskMetaLine item={item} showAssignee />
      </div>
    </div>
  );
}
