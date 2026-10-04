"use client";

import type { DragEvent, MouseEvent } from "react";
import { Lock, MoreVertical } from "lucide-react";
import { formatBytes } from "@/lib/dataroom/config";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ItemIcon } from "@/features/dataroom/components/item-icon";
import type { DataroomItem } from "@/features/dataroom/types";

/** Interaksi item (pilih, buka, menu, seret-lepas) yang dimiliki halaman Dataroom. */
export interface ItemInteractions {
  draggable: boolean;
  selected: Set<string>;
  dropTarget: string | null;
  onDragStart: (e: DragEvent, item: DataroomItem) => void;
  onDragOver: (e: DragEvent, folderId: string) => void;
  onDragLeave: (folderId: string) => void;
  onDrop: (e: DragEvent, folderId: string) => void;
  onClick: (e: MouseEvent, item: DataroomItem) => void;
  onOpen: (item: DataroomItem) => void;
  onContextMenu: (e: MouseEvent, item: DataroomItem) => void;
}

/** Props DOM bersama untuk kartu (grid) dan baris (daftar); folder menjadi target drop. */
function itemProps(item: DataroomItem, ui: ItemInteractions) {
  const isFolder = item.kind === "folder";
  return {
    draggable: ui.draggable,
    onDragStart: (e: DragEvent) => ui.onDragStart(e, item),
    onDragOver: isFolder ? (e: DragEvent) => ui.onDragOver(e, item.id) : undefined,
    onDragLeave: isFolder ? () => ui.onDragLeave(item.id) : undefined,
    onDrop: isFolder ? (e: DragEvent) => ui.onDrop(e, item.id) : undefined,
    onClick: (e: MouseEvent) => ui.onClick(e, item),
    onDoubleClick: () => ui.onOpen(item),
    onContextMenu: (e: MouseEvent) => ui.onContextMenu(e, item),
  };
}

const departmentNames = (item: DataroomItem) => (item.departments ?? []).map((d) => d.name).join(", ");

export function ItemGrid({ items, ui }: { items: DataroomItem[]; ui: ItemInteractions }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => (
        <div
          key={item.id}
          {...itemProps(item, ui)}
          className={cn(
            "group relative flex cursor-default select-none flex-col rounded-xl border bg-card p-3 transition",
            "hover:border-primary/40 hover:shadow-sm",
            ui.selected.has(item.id) && "border-primary bg-primary/10",
            ui.dropTarget === item.id && "border-primary bg-primary/15 ring-2 ring-primary"
          )}
        >
          <div className="flex items-start justify-between">
            <ItemIcon kind={item.kind} mime={item.mime} name={item.name} className="h-10 w-10" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); ui.onContextMenu(e, item); }}
              className="rounded-md p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100 sm:opacity-0 max-sm:opacity-100"
              aria-label="Menu"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 line-clamp-2 break-words text-sm font-medium leading-tight" title={item.name}>{item.name}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {item.kind === "file" ? formatBytes(item.size_bytes) : "Folder"} · {formatDate(item.updated_at)}
          </p>
          {item.departments && item.departments.length > 0 && (
            <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-amber-700" title={departmentNames(item)}>
              <Lock className="h-3 w-3 shrink-0" />
              <span className="truncate">{departmentNames(item)}</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function ItemTable({ items, ui }: { items: DataroomItem[]; ui: ItemInteractions }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Nama</th>
            <th className="px-3 py-2 text-left font-medium">Pemilik</th>
            <th className="px-3 py-2 text-left font-medium">Diubah</th>
            <th className="px-3 py-2 text-right font-medium">Ukuran</th>
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              {...itemProps(item, ui)}
              className={cn(
                "cursor-default select-none border-t hover:bg-muted/50",
                ui.selected.has(item.id) && "bg-primary/10",
                ui.dropTarget === item.id && "bg-primary/15 ring-2 ring-inset ring-primary"
              )}
            >
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <ItemIcon kind={item.kind} mime={item.mime} name={item.name} className="h-5 w-5 shrink-0" />
                  <span className="truncate">{item.name}</span>
                  {item.departments && item.departments.length > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700" title={departmentNames(item)}>
                      <Lock className="h-3 w-3" />{item.departments.length === 1 ? item.departments[0].name : `${item.departments.length} departemen`}
                    </span>
                  )}
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{item.created_by_name ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(item.updated_at)}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">{item.kind === "file" ? formatBytes(item.size_bytes) : "—"}</td>
              <td className="px-2 py-2">
                <button type="button" onClick={(e) => { e.stopPropagation(); ui.onContextMenu(e, item); }} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Menu"><MoreVertical className="h-4 w-4" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
