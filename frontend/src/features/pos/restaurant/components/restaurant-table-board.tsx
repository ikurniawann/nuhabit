"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LayoutGrid, Loader2, Map as MapIcon, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FloorPlanCanvas,
  type FloorPlanNode,
} from "@/features/pos/tables/components/floor-plan-canvas";
import { floorLabel, floorSortKey } from "@/features/pos/tables/floor-options";
import { buildCashierHandoffUrl } from "@/features/pos/restaurant/nav";
import {
  canPickMergeDestination,
  canPickMoveDestination,
  canPickSeatDestination,
  canPickTransferDestination,
} from "@/features/pos/restaurant/move-destination";
import { capacityWarning, normalizeGuestCount } from "@/lib/pos/guest-count";
import { cn } from "@/lib/utils";
import {
  RestaurantTableGrid,
  TABLE_STATUS_LEGEND,
} from "@/features/pos/restaurant/components/restaurant-table-grid";
import type { PosTable } from "@/lib/pos-api";

export type RestaurantBoardMode =
  | "move"
  | "transfer"
  | "merge"
  | "seat"
  | null;

interface TableFloorGroup {
  floorKey: string;
  label: string;
  tables: PosTable[];
}

function getTableDisplayName(table: PosTable) {
  return table.label || table.table_number || table.name || "Table";
}

function groupTablesByFloor(tables: PosTable[]): TableFloorGroup[] {
  const map = new Map<string, PosTable[]>();
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
        getTableDisplayName(a).localeCompare(getTableDisplayName(b), undefined, {
          numeric: true,
        })
      ),
    }));
}

function toNode(table: PosTable): FloorPlanNode {
  return {
    id: table.id,
    // Di denah cukup NOMOR meja (mis. "5-01") — nama panjang ("Table 5-01")
    // terpotong dan tidak terbaca dari jauh. Nama lengkap tetap dipakai di
    // daftar/tooltip lewat getTableDisplayName.
    table_number: table.table_number || getTableDisplayName(table),
    capacity: table.capacity,
    status: table.status,
    is_active: table.is_active,
    pos_x: table.pos_x,
    pos_y: table.pos_y,
    billCount: table.bill_count ?? table.active_orders?.length ?? 0,
  };
}

function canPickForMode(
  mode: RestaurantBoardMode,
  table: PosTable,
  sourceTableId?: string | null,
  sourceBill?: { checkout_id?: string | null; sold_from?: string | null }
) {
  const opts = { sourceTableId };
  if (mode === "move") return canPickMoveDestination(table, opts);
  if (mode === "seat") {
    return canPickSeatDestination(table, opts);
  }
  if (mode === "transfer") return canPickTransferDestination(table, opts);
  if (mode === "merge") {
    return canPickMergeDestination(table, {
      ...opts,
      sourceBill,
      destOrders: table.active_orders,
    });
  }
  return false;
}

function modeHint(mode: RestaurantBoardMode) {
  if (mode === "move") return " · tap available or occupied to move";
  if (mode === "seat") return " · tap available to seat";
  if (mode === "transfer") return " · tap a table for items";
  if (mode === "merge") return " · tap occupied to merge";
  return "";
}

function pickBlockedMessage(mode: RestaurantBoardMode) {
  if (mode === "move") return "Choose an available or occupied table.";
  if (mode === "seat") return "Choose an available table.";
  if (mode === "transfer") return "Choose an available or occupied table.";
  if (mode === "merge") return "Choose an occupied table.";
  return "Choose a destination table.";
}

type BoardView = "grid" | "plan";
const VIEW_KEY = "pos.restaurant.view";
const FLOOR_KEY = "pos.restaurant.floor";

const PREF_EVENT = "pos-restaurant-pref";
const memoryPrefs = new Map<string, string>();

function readPref(key: string) {
  try {
    return window.localStorage.getItem(key) ?? memoryPrefs.get(key) ?? null;
  } catch {
    return memoryPrefs.get(key) ?? null;
  }
}

function writePref(key: string, value: string) {
  memoryPrefs.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // mode privat / storage diblokir — preferensi cukup di memori
  }
  window.dispatchEvent(new Event(PREF_EVENT));
}

function subscribePrefs(onChange: () => void) {
  window.addEventListener(PREF_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PREF_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Preferensi per-perangkat (tab lantai, grid/denah); server render = null. */
function usePref(key: string) {
  return useSyncExternalStore(
    subscribePrefs,
    () => readPref(key),
    () => null
  );
}

function isBusyTable(table: PosTable) {
  return table.status === "occupied" || table.status === "billing";
}

export interface RestaurantTableBoardProps {
  tables: PosTable[];
  isLoading?: boolean;
  error?: string | null;
  selectedTableId?: string | null;
  immersive?: boolean;
  boardMode?: RestaurantBoardMode;
  /** @deprecated use boardMode */
  moveMode?: boolean;
  busy?: boolean;
  moving?: boolean;
  sourceTableId?: string | null;
  sourceBill?: { checkout_id?: string | null; sold_from?: string | null };
  onSelectOccupied: (table: PosTable) => void;
  onOpenAvailable?: (table: PosTable) => void;
  onPickDestination?: (table: PosTable) => void;
}

export function RestaurantTableBoard({
  tables,
  isLoading,
  error,
  selectedTableId,
  immersive = false,
  boardMode = null,
  moveMode = false,
  busy = false,
  moving = false,
  sourceTableId = null,
  sourceBill,
  onSelectOccupied,
  onOpenAvailable,
  onPickDestination,
}: RestaurantTableBoardProps) {
  const router = useRouter();
  const floors = groupTablesByFloor(tables);
  const tablesById = new Map(tables.map((table) => [table.id, table]));
  const mode: RestaurantBoardMode = boardMode ?? (moveMode ? "move" : null);
  const isBusy = busy || moving;
  const inBoardMode = mode != null;

  /**
   * Meja yang menunggu jumlah tamu (EPIC-038). Pramusaji mengisi saat
   * mendudukkan — di sinilah angkanya paling akurat, karena tamunya ada di
   * depan mata. Masih bisa dikoreksi di kasir saat bayar.
   */
  const [tableMenungguPax, setTableMenungguPax] = useState<PosTable | null>(null);
  // Tampilan grid rapi (default, owner 2026-10-01) atau denah bebas (posisi
  // dari editor Tables). Lantai ditampilkan per tab, bukan ditumpuk.
  const view: BoardView = usePref(VIEW_KEY) === "plan" ? "plan" : "grid";
  const floorKey = usePref(FLOOR_KEY);
  const activeFloor =
    floors.find((group) => group.floorKey === floorKey) ?? floors[0] ?? null;
  const changeView = (next: BoardView) => writePref(VIEW_KEY, next);
  const changeFloor = (key: string) => writePref(FLOOR_KEY, key);
  const [paxInput, setPaxInput] = useState("");

  const lanjutKeKasir = (table: PosTable, pax: number) => {
    setTableMenungguPax(null);
    setPaxInput("");
    router.push(buildCashierHandoffUrl({ tableId: table.id, immersive, pax }));
  };

  const handlePick = (table: PosTable) => {
    if (!inBoardMode || isBusy) return;
    if (!canPickForMode(mode, table, sourceTableId, sourceBill)) {
      toast.message(pickBlockedMessage(mode));
      return;
    }
    onPickDestination?.(table);
  };

  const handleAvailableClick = (table: PosTable) => {
    if (inBoardMode) {
      handlePick(table);
      return;
    }
    onOpenAvailable?.(table);
    setPaxInput("");
    setTableMenungguPax(table);
  };

  const handleOccupiedDoubleClick = (table: PosTable) => {
    if (inBoardMode || isBusy) return;
    const checkout = table.open_checkouts?.[0];
    const stallOrders = (table.active_orders || []).filter(
      (order) => !order.checkout_id
    );
    if (checkout && stallOrders.length === 0) {
      router.push(
        buildCashierHandoffUrl({
          checkoutId: checkout.id,
          tableId: table.id,
          immersive,
        })
      );
      return;
    }
    if (!checkout && stallOrders.length === 1 && stallOrders[0]?.id) {
      router.push(
        buildCashierHandoffUrl({
          orderId: stallOrders[0].id,
          tableId: table.id,
          immersive,
        })
      );
      return;
    }
    if ((table.bill_count ?? 0) > 1) {
      toast.message("Pick a bill from the list to open.");
      return;
    }
    if (table.active_order?.id) {
      router.push(
        buildCashierHandoffUrl({
          orderId: table.active_order.id,
          tableId: table.id,
          immersive,
        })
      );
      return;
    }
    toast.error("This table has no active order to open.");
  };

  const isTableDisabled = (table: PosTable) => {
    if (inBoardMode) {
      return isBusy || !canPickForMode(mode, table, sourceTableId, sourceBill);
    }
    return (
      table.status !== "available" &&
      table.status !== "occupied" &&
      table.status !== "billing"
    );
  };

  const activateTable = (table: PosTable) => {
    if (inBoardMode) {
      handlePick(table);
      return;
    }
    if (table.status === "available") {
      handleAvailableClick(table);
    } else if (isBusyTable(table)) {
      onSelectOccupied(table);
    }
  };

  const doubleClickTable = (table: PosTable) => {
    if (inBoardMode || isBusy || !isBusyTable(table)) return;
    handleOccupiedDoubleClick(table);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          className="border-gray-200/70 sm:flex-1"
          disabled={inBoardMode || isBusy}
          onClick={() =>
            router.push(buildCashierHandoffUrl({ orderType: "dine_in", immersive }))
          }
        >
          Without Table
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-gray-200/70 sm:flex-1"
          disabled={inBoardMode || isBusy}
          onClick={() =>
            router.push(buildCashierHandoffUrl({ orderType: "takeaway", immersive }))
          }
        >
          Take Away
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tables...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm font-medium text-red-600">
          {error}
        </div>
      ) : floors.length === 0 ? (
        <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-gray-500">
          No active tables found.
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200/70 bg-white dark:bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/70 px-4 py-3">
            {floors.length > 1 ? (
              <div role="tablist" aria-label="Lantai" className="flex flex-wrap gap-1.5">
                {floors.map((group) => {
                  const active = group.floorKey === activeFloor?.floorKey;
                  const busyCount = group.tables.filter(isBusyTable).length;
                  return (
                    <button
                      key={group.floorKey || "__unassigned"}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => changeFloor(group.floorKey)}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition",
                        active
                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-gray-200 bg-white text-gray-700 hover:border-primary/40 hover:text-brand-text dark:bg-transparent dark:text-gray-200"
                      )}
                    >
                      {group.label}
                      {busyCount > 0 ? (
                        <span
                          className={cn(
                            "rounded-full px-1.5 text-[11px] tabular-nums",
                            active ? "bg-white/25" : "bg-orange-100 text-orange-700"
                          )}
                        >
                          {busyCount}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {activeFloor?.label}
              </h3>
            )}
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5" role="group" aria-label="Tampilan meja">
              {(
                [
                  { value: "grid", label: "Grid", icon: LayoutGrid },
                  { value: "plan", label: "Denah", icon: MapIcon },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={view === option.value}
                  onClick={() => changeView(option.value)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition",
                    view === option.value
                      ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                      : "text-gray-600 hover:text-gray-900 dark:text-gray-300"
                  )}
                >
                  <option.icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 text-xs text-gray-600 dark:text-gray-300">
            {/* Warna legenda = mode grid; denah memakai warna lamanya sendiri. */}
            {view === "grid" && TABLE_STATUS_LEGEND.map((item) => (
              <span key={item.status} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2.5 w-2.5 rounded-full", item.dot)} />
                {item.label}
              </span>
            ))}
            <span className="text-gray-400">
              {view === "grid" ? "· " : ""}{activeFloor?.tables.length ?? 0} meja{modeHint(mode)}
            </span>
          </div>

          <div className="p-4">
            {activeFloor && view === "grid" ? (
              <RestaurantTableGrid
                tables={activeFloor.tables}
                selectedId={selectedTableId}
                isDisabled={(table) => isTableDisabled(table)}
                onActivate={activateTable}
                onDoubleClick={doubleClickTable}
              />
            ) : activeFloor ? (
              <FloorPlanCanvas
                mode="operate"
                tables={activeFloor.tables.map(toNode)}
                selectedId={selectedTableId}
                isDisabled={(node) => {
                  const table = tablesById.get(node.id);
                  return table ? isTableDisabled(table) : true;
                }}
                onActivate={(node) => {
                  const table = tablesById.get(node.id);
                  if (table) activateTable(table);
                }}
                onDoubleClick={(node) => {
                  const table = tablesById.get(node.id);
                  if (table) doubleClickTable(table);
                }}
              />
            ) : null}
          </div>
        </section>
      )}

      {/* Jumlah tamu saat mendudukkan (EPIC-038). Tombol cepat menutupi mayoritas
          kasus; input bebas untuk rombongan. Lewati = 1 orang, sesuai default
          yang ditegakkan di database — jadi pramusaji yang buru-buru tidak
          terhalang. */}
      {tableMenungguPax && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Jumlah tamu"
          onClick={() => setTableMenungguPax(null)}
        >
          <div
            className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-gray-900">
              <Users className="h-4 w-4" />
              <span className="font-semibold">
                Berapa tamu di {tableMenungguPax.table_number || "meja ini"}?
              </span>
            </div>
            {tableMenungguPax.capacity ? (
              <p className="mt-1 text-xs text-gray-500">
                Kapasitas {tableMenungguPax.capacity} kursi
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {[1, 2, 4, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => lanjutKeKasir(tableMenungguPax, n)}
                  className="min-w-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-primary hover:text-brand-text"
                >
                  {n}
                </button>
              ))}
            </div>

            <input
              type="number"
              min={1}
              inputMode="numeric"
              autoFocus
              value={paxInput}
              onChange={(e) => setPaxInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  lanjutKeKasir(tableMenungguPax, normalizeGuestCount(paxInput));
                }
              }}
              placeholder="Jumlah lain"
              aria-label="Jumlah tamu lain"
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />

            {(() => {
              const peringatan = capacityWarning(
                normalizeGuestCount(paxInput),
                tableMenungguPax.capacity ?? null
              );
              return peringatan && paxInput.trim() !== "" ? (
                <p className="mt-2 text-xs text-amber-700">{peringatan}</p>
              ) : null;
            })()}

            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => lanjutKeKasir(tableMenungguPax, 1)}
              >
                Lewati (1 orang)
              </Button>
              <Button
                className="flex-1"
                onClick={() =>
                  lanjutKeKasir(tableMenungguPax, normalizeGuestCount(paxInput))
                }
              >
                Lanjut
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
