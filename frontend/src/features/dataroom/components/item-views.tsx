"use client";

import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { ArrowDown, ArrowUp, Lock, MoreVertical, Star } from "lucide-react";
import { formatBytes } from "@/lib/dataroom/config";
import type { SortDir, SortKey } from "@/lib/dataroom/drive";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ItemIcon } from "@/features/dataroom/components/item-icon";
import type { DataroomItem } from "@/features/dataroom/types";

/** Interaksi item (pilih, buka, menu, seret-lepas, keyboard) yang dimiliki halaman Dataroom. */
export interface ItemInteractions {
  draggable: boolean;
  selected: Set<string>;
  focusedId: string | null;
  dropTarget: string | null;
  onDragStart: (e: DragEvent, item: DataroomItem) => void;
  onDragOver: (e: DragEvent, folderId: string) => void;
  onDragLeave: (folderId: string) => void;
  onDrop: (e: DragEvent, folderId: string) => void;
  onClick: (e: MouseEvent, item: DataroomItem) => void;
  onOpen: (item: DataroomItem) => void;
  onContextMenu: (e: MouseEvent, item: DataroomItem) => void;
  onKeyDown: (e: KeyboardEvent, item: DataroomItem, index: number) => void;
  onFocus: (item: DataroomItem) => void;
}

/** Props DOM bersama untuk kartu (grid) dan baris (daftar); folder menjadi target drop. */
function itemProps(item: DataroomItem, index: number, ui: ItemInteractions) {
  const isFolder = item.kind === "folder";
  const selected = ui.selected.has(item.id);
  return {
    "data-item-id": item.id,
    role: "option" as const,
    "aria-selected": selected,
    tabIndex: ui.focusedId === item.id || (ui.focusedId === null && index === 0) ? 0 : -1,
    draggable: ui.draggable,
    onDragStart: (e: DragEvent) => ui.onDragStart(e, item),
    onDragOver: isFolder ? (e: DragEvent) => ui.onDragOver(e, item.id) : undefined,
    onDragLeave: isFolder ? () => ui.onDragLeave(item.id) : undefined,
    onDrop: isFolder ? (e: DragEvent) => ui.onDrop(e, item.id) : undefined,
    onClick: (e: MouseEvent) => ui.onClick(e, item),
    onDoubleClick: () => ui.onOpen(item),
    onContextMenu: (e: MouseEvent) => ui.onContextMenu(e, item),
    onKeyDown: (e: KeyboardEvent) => ui.onKeyDown(e, item, index),
    onFocus: () => ui.onFocus(item),
  };
}

const departmentNames = (item: DataroomItem) => (item.departments ?? []).map((d) => d.name).join(", ");

/** Lencana kecil: bintang, kunci edit, akses departemen, lokasi (pencarian). */
function Badges({ item, compact = false }: { item: DataroomItem; compact?: boolean }) {
  return (
    <>
      {item.starred && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" aria-label="Berbintang" />}
      {item.locked_by_name && (
        <span className="flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800" title={`Sedang diedit oleh ${item.locked_by_name}`}>
          <Lock className="h-3 w-3" />{compact ? "" : `Diedit: ${item.locked_by_name}`}
        </span>
      )}
      {item.departments && item.departments.length > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700" title={departmentNames(item)}>
          <Lock className="h-3 w-3" />{item.departments.length === 1 ? item.departments[0].name : `${item.departments.length} departemen`}
        </span>
      )}
    </>
  );
}

const pathLabel = (item: DataroomItem) => (item.path && item.path.length > 0 ? item.path.map((p) => p.name).join(" / ") : "Dataroom");

export function ItemGrid({ items, ui, showPath }: { items: DataroomItem[]; ui: ItemInteractions; showPath?: boolean }) {
  return (
    <div role="listbox" aria-multiselectable aria-label="Daftar item" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item, index) => (
        <div
          key={item.id}
          {...itemProps(item, index, ui)}
          className={cn(
            "group relative flex cursor-default select-none flex-col rounded-xl border bg-card p-3 transition outline-none",
            "hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring",
            ui.selected.has(item.id) && "border-primary bg-primary/10",
            ui.dropTarget === item.id && "border-primary bg-primary/15 ring-2 ring-primary",
            item.trashed_at && "opacity-80"
          )}
        >
          <div className="flex items-start justify-between">
            <ItemIcon kind={item.kind} mime={item.mime} name={item.name} className="h-10 w-10" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); ui.onContextMenu(e, item); }}
              className="rounded-md p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100 max-sm:opacity-100"
              aria-label={`Menu ${item.name}`}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 line-clamp-2 break-words text-sm font-medium leading-tight" title={item.name}>{item.name}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {item.kind === "file" ? formatBytes(item.size_bytes) : "Folder"} · {formatDate(item.updated_at)}
          </p>
          {showPath && <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={pathLabel(item)}>{pathLabel(item)}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1"><Badges item={item} compact /></div>
        </div>
      ))}
    </div>
  );
}

export interface SortState { key: SortKey; dir: SortDir }

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: "name", label: "Nama", className: "text-left" },
  { key: "owner", label: "Pemilik", className: "text-left" },
  { key: "updated", label: "Diubah", className: "text-left" },
  { key: "size", label: "Ukuran", className: "text-right" },
];

export function ItemTable({ items, ui, sort, onSort, showPath }: {
  items: DataroomItem[]; ui: ItemInteractions; sort: SortState; onSort: (key: SortKey) => void; showPath?: boolean;
}) {
  const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-3 py-2 font-medium", c.className)}>
                <button type="button" onClick={(e) => { e.stopPropagation(); onSort(c.key); }} className={cn("inline-flex items-center gap-1 rounded hover:text-foreground", sort.key === c.key && "text-foreground")}>
                  {c.label}{sort.key === c.key && <Arrow className="h-3 w-3" />}
                </button>
              </th>
            ))}
            <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Menu</span></th>
          </tr>
        </thead>
        <tbody role="listbox" aria-multiselectable aria-label="Daftar item">
          {items.map((item, index) => (
            <tr
              key={item.id}
              {...itemProps(item, index, ui)}
              className={cn(
                "cursor-default select-none border-t outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                ui.selected.has(item.id) && "bg-primary/10",
                ui.dropTarget === item.id && "bg-primary/15 ring-2 ring-inset ring-primary"
              )}
            >
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <ItemIcon kind={item.kind} mime={item.mime} name={item.name} className="h-5 w-5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate">{item.name}</span>
                    {showPath && <span className="block truncate text-[11px] text-muted-foreground">{pathLabel(item)}</span>}
                  </span>
                  <Badges item={item} />
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{item.created_by_name ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(item.updated_at)}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">{item.kind === "file" ? formatBytes(item.size_bytes) : "—"}</td>
              <td className="px-2 py-2">
                <button type="button" onClick={(e) => { e.stopPropagation(); ui.onContextMenu(e, item); }} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label={`Menu ${item.name}`}><MoreVertical className="h-4 w-4" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
