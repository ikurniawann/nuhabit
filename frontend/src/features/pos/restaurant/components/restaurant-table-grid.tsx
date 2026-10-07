"use client";

import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PosTable } from "@/lib/pos-api";
import {
  chairLayout,
  drawnChairCount,
  groupTablesByArea,
  isWideTable,
  seatedChairCount,
} from "@/features/pos/restaurant/table-grid-layout";

/**
 * Papan meja mode grid (owner 2026-10-01, referensi "Manage Tables"): meja
 * berjajar rapi per area, kursi di sekeliling meja, kursi terisi = tamu duduk.
 */

type Tone = { table: string; seat: string; text: string };

const TONES: Record<string, Tone> = {
  available: {
    table: "bg-indigo-50 border-indigo-100 dark:bg-indigo-500/10 dark:border-indigo-400/20",
    seat: "border-indigo-200 bg-white dark:border-indigo-400/40 dark:bg-transparent",
    text: "text-indigo-500 dark:text-indigo-300",
  },
  occupied: {
    table: "bg-orange-100 border-orange-200 dark:bg-orange-500/15 dark:border-orange-400/30",
    seat: "border-orange-500 bg-orange-500",
    text: "text-orange-700 dark:text-orange-300",
  },
  billing: {
    table: "bg-red-100 border-red-200 dark:bg-red-500/15 dark:border-red-400/30",
    seat: "border-red-500 bg-red-500",
    text: "text-red-700 dark:text-red-300",
  },
  reserved: {
    table: "bg-teal-100 border-teal-200 dark:bg-teal-500/15 dark:border-teal-400/30",
    seat: "border-teal-500 bg-white dark:bg-transparent",
    text: "text-teal-800 dark:text-teal-300",
  },
  maintenance: {
    table: "bg-gray-100 border-gray-200 dark:bg-gray-500/15 dark:border-gray-400/30",
    seat: "border-gray-300 bg-white dark:bg-transparent",
    text: "text-gray-500",
  },
};

const EMPTY_SEAT = "border-gray-300 bg-white dark:border-gray-600 dark:bg-transparent";

export const TABLE_STATUS_LEGEND: Array<{ status: string; label: string; dot: string }> = [
  { status: "available", label: "Kosong", dot: "bg-indigo-400" },
  { status: "occupied", label: "Terisi", dot: "bg-orange-500" },
  { status: "billing", label: "Minta bill", dot: "bg-red-500" },
  { status: "reserved", label: "Reservasi", dot: "bg-teal-500" },
];

function toneOf(status: string): Tone {
  return TONES[status] ?? TONES.maintenance;
}

type Side = "top" | "bottom" | "left" | "right";

function Chair({ side, filled, tone }: { side: Side; filled: boolean; tone: Tone }) {
  return (
    <span
      className={cn(
        "block border-2 transition-colors",
        side === "top" && "h-3 w-6 rounded-t-lg rounded-b-sm",
        side === "bottom" && "h-3 w-6 rounded-b-lg rounded-t-sm",
        side === "left" && "h-6 w-3 rounded-l-lg rounded-r-sm",
        side === "right" && "h-6 w-3 rounded-r-lg rounded-l-sm",
        filled ? tone.seat : EMPTY_SEAT
      )}
    />
  );
}

export function displayTableName(table: PosTable) {
  return table.label || table.table_number || table.name || "Meja";
}

function TableTile({
  table,
  selected,
  disabled,
  onActivate,
  onDoubleClick,
}: {
  table: PosTable;
  selected: boolean;
  disabled: boolean;
  onActivate: (table: PosTable) => void;
  onDoubleClick?: (table: PosTable) => void;
}) {
  const tone = toneOf(table.status);
  const layout = chairLayout(table.capacity);
  const drawn = drawnChairCount(layout);
  const guests = Math.max(0, Number(table.guest_count) || 0);
  const isSeated = table.status === "occupied" || table.status === "billing";
  const seated = seatedChairCount(table.status, guests, drawn);
  // Isi kursi berurutan: atas → bawah → kiri → kanan.
  const seats = (offset: number, count: number) =>
    Array.from({ length: count }, (_, i) => offset + i < seated);
  const top = seats(0, layout.top);
  const bottom = seats(layout.top, layout.bottom);
  const left = seats(layout.top + layout.bottom, layout.left);
  const right = seats(layout.top + layout.bottom + layout.left, layout.right);
  const billCount = table.bill_count ?? table.active_orders?.length ?? 0;
  const number = table.table_number || displayTableName(table);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${displayTableName(table)} · ${table.capacity} kursi · ${table.status}`}
      onClick={() => onActivate(table)}
      onDoubleClick={() => onDoubleClick?.(table)}
      className={cn(
        "group grid touch-manipulation grid-cols-[auto_1fr_auto] grid-rows-[auto_1fr_auto] items-center gap-1.5 rounded-2xl p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isWideTable(table.capacity) && "sm:col-span-2",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      )}
    >
      <span />
      <span aria-hidden className="flex min-h-3 justify-around px-2">
        {top.map((filled, i) => (
          <Chair key={i} side="top" filled={filled} tone={tone} />
        ))}
      </span>
      <span />

      <span aria-hidden className="flex flex-col justify-center gap-2">
        {left.map((filled, i) => (
          <Chair key={i} side="left" filled={filled} tone={tone} />
        ))}
      </span>
      <span
        className={cn(
          "relative flex min-h-20 flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition",
          tone.table,
          tone.text,
          !disabled && "group-hover:brightness-[0.97] group-active:scale-[0.98]",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
      >
        <span className="max-w-full truncate text-sm font-semibold">{number}</span>
        <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium opacity-80">
          <Users className="h-3.5 w-3.5" />
          {isSeated && guests > 0 ? `${guests}/${table.capacity}` : table.capacity}
        </span>
        {billCount > 1 ? (
          <span className="absolute right-1.5 top-1.5 rounded-md bg-white/80 px-1 text-[10px] font-bold tabular-nums dark:bg-black/30">
            {billCount} bill
          </span>
        ) : null}
      </span>
      <span aria-hidden className="flex flex-col justify-center gap-2">
        {right.map((filled, i) => (
          <Chair key={i} side="right" filled={filled} tone={tone} />
        ))}
      </span>

      <span />
      <span aria-hidden className="flex min-h-3 justify-around px-2">
        {bottom.map((filled, i) => (
          <Chair key={i} side="bottom" filled={filled} tone={tone} />
        ))}
      </span>
      <span />
    </button>
  );
}

export function RestaurantTableGrid({
  tables,
  selectedId,
  isDisabled,
  onActivate,
  onDoubleClick,
}: {
  tables: PosTable[];
  selectedId?: string | null;
  isDisabled: (table: PosTable) => boolean;
  onActivate: (table: PosTable) => void;
  onDoubleClick?: (table: PosTable) => void;
}) {
  const areas = groupTablesByArea(tables, displayTableName);
  return (
    <div className="space-y-6">
      {areas.map((group) => (
        <section key={group.area || "__none"} className="space-y-3">
          {areas.length > 1 || group.area ? (
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.area || "Lainnya"} · {group.tables.length} meja
            </h4>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-5">
            {group.tables.map((table) => (
              <TableTile
                key={table.id}
                table={table}
                selected={selectedId === table.id}
                disabled={isDisabled(table)}
                onActivate={onActivate}
                onDoubleClick={onDoubleClick}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
