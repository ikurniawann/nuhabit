"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton-table";
import { ASSIGNMENT_STATUS } from "../view";
import type { FeedbackAssignmentStatus, FeedbackCycle } from "../types";

export function AssignmentStatusBadge({ status }: { status: FeedbackAssignmentStatus }) {
  const meta = ASSIGNMENT_STATUS[status] ?? ASSIGNMENT_STATUS.pending;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/** Bilah progres 0–100; tanpa `label` hanya hiasan (angkanya sudah tertulis di dekatnya). */
export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const a11y = label
    ? { role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent }
    : { "aria-hidden": true };
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface" {...a11y}>
      <div className="h-2 rounded-full bg-forest" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Kerangka saat memuat, pesan galat, atau pesan kosong. */
export function QueryState({ loading, error, empty }: { loading?: boolean; error?: Error | null; empty?: string }) {
  if (loading) return <SkeletonCard />;
  const message = error ? error.message || "Gagal memuat data" : empty;
  if (!message) return null;
  return (
    <Card>
      <CardContent className={`py-10 text-center text-sm ${error ? "text-danger" : "text-muted-foreground"}`}>
        {message}
      </CardContent>
    </Card>
  );
}

interface CycleSelectProps {
  id: string;
  cycles: readonly FeedbackCycle[];
  value: string;
  onChange: (id: string) => void;
}

export function CycleSelect({ id, cycles, value, onChange }: CycleSelectProps) {
  return (
    <div className="w-full max-w-xs">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        Siklus
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Pilih siklus" />
        </SelectTrigger>
        <SelectContent>
          {cycles.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name} ({c.period_label})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
