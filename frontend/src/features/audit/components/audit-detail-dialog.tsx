"use client";

import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { diffAudit } from "@/lib/audit/diff";
import { formatDateTime } from "@/lib/format";
import type { AuditRow } from "../api";
import { ACTION_LABELS } from "./audit-labels";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function AuditDetailDialog({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const changes = diffAudit(row.before, row.after);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>{ACTION_LABELS[row.action] ?? row.action}</DialogPanelTitle>
          <DialogPanelDescription>
            {row.entity_label ?? row.entity_id} · {row.actor_name ?? "Sistem"} ·{" "}
            {formatDateTime(row.created_at)}
            {row.ip ? ` · IP ${row.ip}` : ""}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {row.reason && (
            <div className="rounded-2xl bg-surface px-4 py-3 text-sm">
              <p className="font-medium">Alasan</p>
              <p className="mt-1 text-body">{row.reason}</p>
            </div>
          )}
          {changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tidak ada perubahan field yang tercatat.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Sebelum</TableHead>
                  <TableHead>Sesudah</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((change) => (
                  <TableRow key={change.field}>
                    <TableCell className="font-mono text-xs">{change.field}</TableCell>
                    <TableCell className="max-w-[14rem] whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                      {formatValue(change.before)}
                    </TableCell>
                    <TableCell className="max-w-[14rem] whitespace-pre-wrap break-words font-mono text-xs">
                      {formatValue(change.after)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
