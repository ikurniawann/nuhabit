"use client";

import type { CSSProperties } from "react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Activity, CalendarDays, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { MONITOR_WIDGETS, type MonitorWidgetKey } from "@/lib/desktop/widgets";
import type { WidgetVisibility } from "../../lib/preferences";
import { ToggleSwitch } from "../settings/toggle-switch";
import { WindowShell } from "../windows/window-shell";

const TILE = "grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground";
const CALENDAR = { title: "Calendar Widget", description: "Kalender bulanan yang bisa dipindahkan dan di-resize." };

export function WidgetSettings({
  visibility,
  order,
  onChange,
  onMove,
  onReorder,
  onClose,
}: {
  visibility: WidgetVisibility;
  order: MonitorWidgetKey[];
  onChange: (key: keyof WidgetVisibility, value: boolean) => void;
  onMove: (key: MonitorWidgetKey, direction: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
  onClose: () => void;
}) {
  // Baris widget monitoring mengikuti urutan pilihan user; Calendar adalah
  // window mengambang, bukan bagian papan, jadi tanpa kontrol urutan.
  const monitorItems = order
    .map((key) => MONITOR_WIDGETS.find((w) => w.key === key))
    .filter((w): w is (typeof MONITOR_WIDGETS)[number] => Boolean(w));

  return (
    /* Dipusatkan lewat `inset-x-0 mx-auto`, BUKAN `left-1/2 -translate-x-1/2`:
       @hello-pangea/dnd menghitung posisi drag relatif terhadap containing
       block, dan `transform` pada leluhur membuat item yang diseret melompat. */
    <WindowShell title="Widgets" onClose={onClose} className="inset-x-0 top-24 mx-auto w-[min(460px,calc(100vw-32px))]">
      <div className="space-y-3 p-5">
        <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="text-sm font-semibold">Desktop Widgets</div>
          <div className="mt-1 text-xs leading-5 text-white/50">
            Calendar Widget aktif secara default. Widget monitoring bisa diaktifkan dan diatur urutannya dengan tombol panah — urutan tersimpan di perangkat ini.
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className={TILE}><CalendarDays className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{CALENDAR.title}</div>
            <div className="text-xs leading-5 text-white/45">{CALENDAR.description}</div>
          </div>
          <ToggleSwitch enabled={visibility.calendar} onChange={(value) => onChange("calendar", value)} label={`Toggle ${CALENDAR.title}`} />
        </div>
        {/* Drag & drop untuk mouse; tombol panah untuk keyboard dan presisi.
            Handle dipisah dari baris supaya klik toggle/panah tidak tertelan gestur drag. */}
        <DragDropContext
          onDragEnd={(hasil: DropResult) => {
            if (hasil.destination) onReorder(hasil.source.index, hasil.destination.index);
          }}
        >
          <Droppable droppableId="widget-monitoring">
            {(dropProvided) => (
              <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-3">
                {monitorItems.map((item, index) => (
                  <Draggable draggableId={item.key} index={index} key={item.key}>
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        // DraggableStyle tidak memuat index signature CSS variable milik CSSProperties.
                        style={dragProvided.draggableProps.style as CSSProperties | undefined}
                        className={`flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4 ${dragSnapshot.isDragging ? "border-white/30 shadow-2xl" : ""}`}
                      >
                        <div
                          {...dragProvided.dragHandleProps}
                          aria-label={`Seret untuk memindahkan ${item.title}`}
                          className="shrink-0 cursor-grab rounded-lg p-1 text-white/35 transition hover:text-white active:cursor-grabbing"
                        >
                          <GripVertical className="size-4" />
                        </div>
                        <div className="flex shrink-0 flex-col gap-0.5">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => onMove(item.key, -1)}
                            aria-label={`Naikkan urutan ${item.title}`}
                            className="rounded-lg p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                          >
                            <ChevronUp className="size-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === monitorItems.length - 1}
                            onClick={() => onMove(item.key, 1)}
                            aria-label={`Turunkan urutan ${item.title}`}
                            className="rounded-lg p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                          >
                            <ChevronDown className="size-4" />
                          </button>
                        </div>
                        <div className={TILE}><Activity className="size-5" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{item.title}</div>
                          <div className="text-xs leading-5 text-white/45">{item.description}</div>
                        </div>
                        <ToggleSwitch enabled={visibility[item.key]} onChange={(value) => onChange(item.key, value)} label={`Toggle ${item.title}`} />
                      </div>
                    )}
                  </Draggable>
                ))}
                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </WindowShell>
  );
}
