"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { floorLabel, floorSortKey } from "../floor-options";
import { usePatchPosTablePosition } from "../mutations";
import type { PosTableRow } from "../types";
import { FloorPlanCanvas, type FloorPlanNode } from "./floor-plan-canvas";

type Props = {
  tables: PosTableRow[];
  onEdit: (table: PosTableRow) => void;
};

type FloorGroup = {
  floorKey: string;
  label: string;
  tables: PosTableRow[];
};

function groupByFloor(tables: PosTableRow[]): FloorGroup[] {
  const map = new Map<string, PosTableRow[]>();
  for (const table of tables) {
    const key = String(table.floor ?? "").trim();
    const list = map.get(key) ?? [];
    list.push(table);
    map.set(key, list);
  }

  return [...map.entries()]
    .sort(([a], [b]) => floorSortKey(a) - floorSortKey(b))
    .map(([floorKey, groupTables]) => ({
      floorKey,
      label: floorLabel(floorKey),
      tables: [...groupTables].sort((a, b) =>
        a.table_number.localeCompare(b.table_number, undefined, {
          numeric: true,
        })
      ),
    }));
}

function toNode(table: PosTableRow): FloorPlanNode {
  return {
    id: table.id,
    table_number: table.table_number,
    capacity: table.capacity,
    status: table.status,
    is_active: table.is_active,
    pos_x: table.pos_x,
    pos_y: table.pos_y,
  };
}

function EditFloorCanvas({
  tables,
  onEdit,
}: {
  tables: PosTableRow[];
  onEdit: (table: PosTableRow) => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const positionMutation = usePatchPosTablePosition();
  const byId = useMemo(
    () => new Map(tables.map((table) => [table.id, table])),
    [tables]
  );

  return (
    <FloorPlanCanvas
      mode="edit"
      tables={tables.map(toNode)}
      savingId={savingId}
      onEdit={(node) => {
        const row = byId.get(node.id);
        if (row) onEdit(row);
      }}
      onSavePosition={async (node, pos) => {
        setSavingId(node.id);
        try {
          const res = await positionMutation.mutateAsync({
            id: node.id,
            pos_x: pos.x,
            pos_y: pos.y,
          });
          toast.success(res.message || "Table position saved");
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Failed to save table position"
          );
        } finally {
          setSavingId(null);
        }
      }}
    />
  );
}

export function TablesFloorPlan({ tables, onEdit }: Props) {
  const groups = useMemo(() => groupByFloor(tables), [tables]);

  if (tables.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200/70 bg-gray-50 py-14 text-center text-sm text-gray-400">
        No tables to show on the floor plan
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section
          key={group.floorKey || "__unassigned"}
          className="overflow-hidden rounded-xl border border-gray-200/70 bg-white"
        >
          <div className="flex items-center justify-between gap-3 border-b border-gray-200/70 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {group.label}
              </h3>
              <p className="text-xs text-gray-500">
                {group.tables.length} table
                {group.tables.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="p-3">
            <EditFloorCanvas tables={group.tables} onEdit={onEdit} />
          </div>
        </section>
      ))}
    </div>
  );
}
