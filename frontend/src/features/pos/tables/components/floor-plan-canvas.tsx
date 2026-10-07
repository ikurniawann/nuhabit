"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildFloorNodePositions, clampPercent } from "@/lib/pos/tables/floor-layout";
import { TableSilhouette } from "./table-silhouette";

// Ukuran node meja. Diperbesar (96 → 136) supaya nomor meja terbaca dari
// jarak kasir/pelayan di layar restoran; posisi tersimpan dalam persen, jadi
// denah lama tetap valid.
export const FLOOR_NODE_W = 136;
export const FLOOR_NODE_H = 136;
const CLICK_THRESHOLD_PX = 4;

export type FloorPlanNode = {
  id: string;
  table_number: string;
  capacity: number;
  status: string;
  is_active?: boolean;
  pos_x?: number | null;
  pos_y?: number | null;
  billCount?: number;
};

type Point = { x: number; y: number };

type DragState = {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export function statusNodeTone(status: string) {
  switch (status) {
    case "available":
      return "text-emerald-600";
    case "occupied":
      return "text-amber-600";
    case "billing":
      return "text-red-600";
    case "reserved":
      return "text-blue-600";
    case "maintenance":
      return "text-slate-500";
    default:
      return "text-gray-500";
  }
}

function clampToCanvas(
  x: number,
  y: number,
  rect: { width: number; height: number }
): Point {
  const maxX =
    rect.width > 0 ? Math.max(0, 100 - (FLOOR_NODE_W / rect.width) * 100) : 100;
  const maxY =
    rect.height > 0
      ? Math.max(0, 100 - (FLOOR_NODE_H / rect.height) * 100)
      : 100;
  return {
    x: clampPercent(Math.min(Math.max(x, 0), maxX)),
    y: clampPercent(Math.min(Math.max(y, 0), maxY)),
  };
}

type FloorPlanCanvasBase = {
  tables: FloorPlanNode[];
};

export type FloorPlanCanvasEditProps = FloorPlanCanvasBase & {
  mode: "edit";
  onEdit: (table: FloorPlanNode) => void;
  onSavePosition: (
    table: FloorPlanNode,
    pos: Point
  ) => Promise<void>;
  savingId?: string | null;
};

export type FloorPlanCanvasOperateProps = FloorPlanCanvasBase & {
  mode: "operate";
  selectedId?: string | null;
  onActivate: (table: FloorPlanNode) => void;
  onDoubleClick?: (table: FloorPlanNode) => void;
  isDisabled?: (table: FloorPlanNode) => boolean;
};

export type FloorPlanCanvasProps =
  | FloorPlanCanvasEditProps
  | FloorPlanCanvasOperateProps;

export function FloorPlanCanvas(props: FloorPlanCanvasProps) {
  const { tables, mode } = props;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<Record<string, Point>>({});
  // Meja yang sedang di-drag (state, bukan ref, karena dipakai saat render).
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const basePositions = useMemo(
    () => buildFloorNodePositions(tables, 5),
    [tables]
  );

  function resolvePosition(id: string): Point {
    return dragging[id] ?? basePositions[id] ?? { x: 4, y: 4 };
  }

  /** When nodes overlap, pick the table whose center is closest to the pointer. */
  function pickTableAtPoint(clientX: number, clientY: number): FloorPlanNode | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { table: FloorPlanNode; dist: number } | null = null;

    for (const table of tables) {
      if (mode === "operate" && props.isDisabled?.(table)) continue;
      const pos = resolvePosition(table.id);
      const left = (pos.x / 100) * rect.width;
      const top = (pos.y / 100) * rect.height;
      if (
        x < left ||
        y < top ||
        x > left + FLOOR_NODE_W ||
        y > top + FLOOR_NODE_H
      ) {
        continue;
      }
      const dist = Math.hypot(
        x - (left + FLOOR_NODE_W / 2),
        y - (top + FLOOR_NODE_H / 2)
      );
      if (!best || dist < best.dist) best = { table, dist };
    }

    return best?.table ?? null;
  }

  function handlePointerDown(
    e: ReactPointerEvent<HTMLDivElement>,
    table: FloorPlanNode
  ) {
    if (mode !== "edit") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = resolvePosition(table.id);
    setActiveDragId(table.id);
    dragStateRef.current = {
      id: table.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: start.x,
      startY: start.y,
      moved: false,
    };
  }

  function handlePointerMove(
    e: ReactPointerEvent<HTMLDivElement>,
    table: FloorPlanNode
  ) {
    if (mode !== "edit") return;
    const ds = dragStateRef.current;
    if (!ds || ds.id !== table.id || ds.pointerId !== e.pointerId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const dxPx = e.clientX - ds.startClientX;
    const dyPx = e.clientY - ds.startClientY;
    if (!ds.moved && Math.hypot(dxPx, dyPx) > CLICK_THRESHOLD_PX) {
      ds.moved = true;
    }

    const next = clampToCanvas(
      ds.startX + (dxPx / rect.width) * 100,
      ds.startY + (dyPx / rect.height) * 100,
      rect
    );
    setDragging((prev) => ({ ...prev, [table.id]: next }));
  }

  async function handlePointerUp(
    e: ReactPointerEvent<HTMLDivElement>,
    table: FloorPlanNode
  ) {
    if (mode !== "edit") return;
    const ds = dragStateRef.current;
    if (!ds || ds.id !== table.id || ds.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    dragStateRef.current = null;
    setActiveDragId(null);

    if (!ds.moved) {
      setDragging((prev) => withoutKey(prev, table.id));
      props.onEdit(table);
      return;
    }

    const finalPos = dragging[table.id] ?? { x: ds.startX, y: ds.startY };
    try {
      await props.onSavePosition(table, finalPos);
    } finally {
      setDragging((prev) => withoutKey(prev, table.id));
    }
  }

  function handlePointerCancel(
    e: ReactPointerEvent<HTMLDivElement>,
    table: FloorPlanNode
  ) {
    if (mode !== "edit") return;
    const ds = dragStateRef.current;
    if (!ds || ds.id !== table.id || ds.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    dragStateRef.current = null;
    setActiveDragId(null);
    setDragging((prev) => withoutKey(prev, table.id));
  }

  const canvasHeight = Math.max(260, Math.ceil(tables.length / 5) * (FLOOR_NODE_H + 40) + 40);
  const savingId = mode === "edit" ? props.savingId ?? null : null;

  return (
    <div
      ref={canvasRef}
      className="relative w-full overflow-hidden rounded-lg border border-gray-200/70 bg-gray-50"
      style={{ minHeight: canvasHeight }}
    >
      {tables.map((table, index) => {
        const pos = resolvePosition(table.id);
        const isSaving = savingId === table.id;
        const isDragging = mode === "edit" && activeDragId === table.id;
        const disabled =
          mode === "operate"
            ? Boolean(props.isDisabled?.(table))
            : Boolean(isSaving);
        const selected =
          mode === "operate" && props.selectedId === table.id;

        return (
          <div
            key={table.id}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            title={`${table.table_number} · ${table.capacity} seats${
              (table.billCount ?? 0) > 1 ? ` · ${table.billCount} bills` : ""
            }`}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (mode === "edit") {
                  props.onEdit(table);
                } else {
                  props.onActivate(table);
                }
              }
            }}
            onClick={(e) => {
              if (mode !== "operate") return;
              const hit = pickTableAtPoint(e.clientX, e.clientY);
              if (!hit) return;
              props.onActivate(hit);
            }}
            onDoubleClick={(e) => {
              if (mode !== "operate") return;
              const hit = pickTableAtPoint(e.clientX, e.clientY);
              if (!hit) return;
              props.onDoubleClick?.(hit);
            }}
            onPointerDown={
              mode === "edit" && !disabled
                ? (e) => handlePointerDown(e, table)
                : undefined
            }
            onPointerMove={
              mode === "edit" ? (e) => handlePointerMove(e, table) : undefined
            }
            onPointerUp={
              mode === "edit" ? (e) => handlePointerUp(e, table) : undefined
            }
            onPointerCancel={
              mode === "edit" ? (e) => handlePointerCancel(e, table) : undefined
            }
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              width: FLOOR_NODE_W,
              height: FLOOR_NODE_H,
              zIndex: selected || isDragging ? 30 : 10 + index,
              touchAction: mode === "edit" ? "none" : "auto",
            }}
            className={cn(
              "absolute select-none rounded-xl p-1 transition-shadow hover:z-40",
              statusNodeTone(table.status),
              table.is_active === false ? "opacity-45" : "opacity-100",
              mode === "edit"
                ? isDragging
                  ? "cursor-grabbing drop-shadow-md"
                  : "cursor-grab"
                : disabled
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer",
              isSaving ? "ring-1 ring-primary/30" : null,
              selected ? "ring-1 ring-primary/40 bg-primary/10" : null
            )}
          >
            {isSaving ? (
              <Loader2 className="absolute right-1.5 top-1.5 z-10 h-3.5 w-3.5 animate-spin text-brand-text" />
            ) : null}
            <TableSilhouette
              capacity={table.capacity}
              label={table.table_number}
            />
            {mode === "operate" && (table.billCount ?? 0) > 1 ? (
              <span className="absolute right-1 top-1 z-10 rounded-md bg-primary/15 px-1 py-0.5 text-[10px] font-semibold tabular-nums text-brand-text">
                {table.billCount}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
