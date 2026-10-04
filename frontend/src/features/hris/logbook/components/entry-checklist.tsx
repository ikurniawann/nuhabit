"use client";

import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SafeHtml } from "@/components/hris/SafeHtml";
import { LogbookStatusBadge } from "./logbook-status";
import type { LogbookEntry, LogbookEntryItem } from "../types";

/**
 * Detail checklist satu entry logbook — dipakai tab Checklist (editable
 * selama draft) dan dialog Riwayat (read-only utk status lain).
 * Notes HTML SELALU dirender lewat <SafeHtml>.
 */
export function LogbookEntryChecklist({
  entry,
  canEdit,
  onToggle,
  onOpenNote,
}: {
  entry: LogbookEntry;
  canEdit: boolean;
  onToggle?: (item: LogbookEntryItem, checked: boolean) => void;
  /** Tanpa handler = tampilan read-only, tombol Catatan disembunyikan */
  onOpenNote?: (item: LogbookEntryItem) => void;
}) {
  const items = [...(entry.items || [])].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold">{entry.title}</h3>
          <p className="text-xs text-muted-foreground">
            {entry.department?.name} · {entry.entry_date}
            {entry.template?.frequency ? ` · ${entry.template.frequency}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LogbookStatusBadge status={entry.status} />
          <span className="text-xs text-muted-foreground">
            {Number(entry.completion_percentage || 0)}% selesai · KPI{" "}
            {Number(entry.kpi_score || 0)}%
          </span>
        </div>
      </div>

      {entry.status === "rejected" && entry.review_notes && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Catatan reviewer: {entry.review_notes}
        </div>
      )}

      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Template ini belum punya checklist item.
          </p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
              item.is_checked
                ? "border-emerald-200 bg-emerald-50/60"
                : "border-border hover:bg-muted/40"
            }`}
          >
            <Checkbox
              checked={item.is_checked}
              disabled={!canEdit || !onToggle}
              onCheckedChange={(checked) => onToggle?.(item, checked === true)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p
                  className={
                    item.is_checked
                      ? "font-medium text-muted-foreground line-through"
                      : "font-medium"
                  }
                >
                  {item.title}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  Bobot {Number(item.weight)}
                </span>
              </div>
              {item.description && (
                <p className="text-xs text-muted-foreground">{item.description}</p>
              )}
              {item.notes && (
                <SafeHtml
                  html={item.notes}
                  className="prose prose-sm mt-2 max-w-none rounded-md bg-muted/50 px-2 py-1 text-xs"
                />
              )}
            </div>
            {onOpenNote && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenNote(item)}
                disabled={!canEdit}
              >
                <FileText className="mr-1 h-3 w-3" /> Catatan
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
