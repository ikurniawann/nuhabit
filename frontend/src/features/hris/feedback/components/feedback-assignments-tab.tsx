"use client";

import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { useDeleteFeedbackAssignment } from "../mutations";
import { useFeedbackAssignments } from "../queries";
import { ASSIGNMENT_STATUS, assignmentStats, relationshipLabel } from "../view";
import type { FeedbackAssignment, FeedbackAssignmentStatus, FeedbackCycle } from "../types";
import { FeedbackAssignDialog } from "./feedback-assign-dialog";
import { AssignmentStatusBadge, CycleSelect, QueryState } from "./feedback-shared";

interface FeedbackAssignmentsTabProps {
  cycles: readonly FeedbackCycle[];
  cycleId: string;
  onCycleChange: (id: string) => void;
}

/** Tab "Penugasan": siapa menilai siapa dalam satu siklus, plus progres per status. */
export function FeedbackAssignmentsTab({ cycles, cycleId, onCycleChange }: FeedbackAssignmentsTabProps) {
  const cycle = cycles.find((c) => c.id === cycleId) ?? null;
  const query = useFeedbackAssignments(cycleId);
  const rows = query.data ?? [];
  const stats = assignmentStats(rows);
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleting, setDeleting] = useState<FeedbackAssignment | null>(null);
  const remove = useDeleteFeedbackAssignment();

  function handleDelete() {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success("Penugasan dihapus");
        setDeleting(null);
      },
      onError: (err) => toast.error(err.message || "Gagal menghapus penugasan"),
    });
  }

  if (cycles.length === 0) return <QueryState empty="Buat siklus terlebih dahulu di tab Siklus." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <CycleSelect id="assignments-cycle" cycles={cycles} value={cycleId} onChange={onCycleChange} />
        <Button onClick={() => setAssignOpen(true)} disabled={!cycle}>
          <UserPlus className="h-4 w-4" />
          Tugaskan Penilai
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(Object.keys(ASSIGNMENT_STATUS) as FeedbackAssignmentStatus[]).map((status) => (
          <Card key={status}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{ASSIGNMENT_STATUS[status].label}</p>
              <p className="text-xl font-semibold tabular-nums">{stats[status]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <QueryState
        loading={query.isLoading}
        error={query.error}
        empty={rows.length === 0 ? "Belum ada penugasan di siklus ini." : undefined}
      />

      {rows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dinilai</TableHead>
                  <TableHead>Penilai</TableHead>
                  <TableHead>Hubungan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tenggat</TableHead>
                  <TableHead>
                    <span className="sr-only">Aksi</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <p className="font-medium">{row.employee?.full_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{row.employee?.department?.name ?? ""}</p>
                    </TableCell>
                    <TableCell>{row.reviewer?.full_name ?? "—"}</TableCell>
                    <TableCell>{relationshipLabel(row.relationship_type)}</TableCell>
                    <TableCell>
                      <AssignmentStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>{formatDate(row.due_date)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Hapus penugasan ${row.reviewer?.full_name ?? ""} untuk ${row.employee?.full_name ?? ""}`}
                        onClick={() => setDeleting(row)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <FeedbackAssignDialog open={assignOpen} cycle={cycle} onOpenChange={setAssignOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus penugasan?"
        description="Jawaban yang sudah diisi penilai untuk penugasan ini ikut terhapus."
        confirmLabel="Hapus"
        loading={remove.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
