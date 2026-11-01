"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { useDecideFeedback } from "../mutations";
import { useFeedbackApprovals } from "../queries";
import { averageRating } from "../view";
import type { FeedbackApproval, FeedbackApprovalFilter } from "../types";
import { AssignmentStatusBadge, QueryState } from "./feedback-shared";

const FILTERS: { value: FeedbackApprovalFilter; label: string }[] = [
  { value: "submitted", label: "Menunggu" },
  { value: "approved", label: "Disetujui" },
  { value: "rejected", label: "Dikembalikan" },
  { value: "all", label: "Semua" },
];

type Pending = { action: "approve" | "reject"; ids: string[] } | null;

/** Tab "Persetujuan": penilaian diri yang terkirim menunggu keputusan HR. */
export function FeedbackApprovalsTab() {
  const [filter, setFilter] = useState<FeedbackApprovalFilter>("submitted");
  const query = useFeedbackApprovals(filter);
  const rows = query.data?.data ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending>(null);
  const waiting = rows.filter((r) => r.status === "submitted");
  const selectedIds = selected.filter((id) => waiting.some((r) => r.id === id));

  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Penilaian diri yang terkirim perlu disetujui sebelum hasil karyawan dikunci. Penilaian yang dikembalikan
        bisa diperbaiki karyawan lalu dikirim ulang.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter status">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? "default" : "outline"}
              aria-pressed={filter === f.value}
              onClick={() => {
                setFilter(f.value);
                setSelected([]);
              }}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {selectedIds.length > 0 ? (
          <Button size="sm" onClick={() => setPending({ action: "approve", ids: selectedIds })}>
            <Check className="h-3.5 w-3.5" />
            Setujui {selectedIds.length} terpilih
          </Button>
        ) : null}
      </div>

      <QueryState
        loading={query.isLoading}
        error={query.error}
        empty={rows.length === 0 ? "Tidak ada penilaian di daftar ini." : undefined}
      />

      <div className="space-y-2">
        {rows.map((row) => (
          <ApprovalCard
            key={row.id}
            row={row}
            selected={selectedIds.includes(row.id)}
            onSelect={(on) => toggle(row.id, on)}
            onDecide={(action) => setPending({ action, ids: [row.id] })}
          />
        ))}
      </div>

      <DecisionDialog
        pending={pending}
        onClose={(done) => {
          if (done) setSelected([]);
          setPending(null);
        }}
      />
    </div>
  );
}

interface ApprovalCardProps {
  row: FeedbackApproval;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onDecide: (action: "approve" | "reject") => void;
}

function ApprovalCard({ row, selected, onSelect, onDecide }: ApprovalCardProps) {
  const [open, setOpen] = useState(false);
  const avg = averageRating(row.responses);
  const name = row.employee?.full_name ?? "Karyawan";
  const waiting = row.status === "submitted";

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start gap-3">
          {waiting ? (
            <Checkbox aria-label={`Pilih ${name}`} checked={selected} onCheckedChange={(v) => onSelect(v === true)} className="mt-1" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{name}</p>
            <p className="text-xs text-muted-foreground">
              {row.cycle?.name ?? "—"} · dikirim {formatDateTime(row.submitted_at)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums">{avg === null ? "—" : avg.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">rata-rata dari 5</p>
          </div>
          <AssignmentStatusBadge status={row.status} />
        </div>
        {row.rejection_reason && row.status === "rejected" ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">Alasan: {row.rejection_reason}</p>
        ) : null}
        {row.manager_comments && row.status === "approved" ? (
          <p className="rounded-md bg-surface px-3 py-2 text-xs">Catatan HR: {row.manager_comments}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {row.responses.length} jawaban
          </Button>
          {waiting ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onDecide("reject")}>
                <X className="h-3.5 w-3.5" />
                Kembalikan
              </Button>
              <Button size="sm" onClick={() => onDecide("approve")}>
                <Check className="h-3.5 w-3.5" />
                Setujui
              </Button>
            </div>
          ) : null}
        </div>
        {open ? (
          <ul className="divide-y rounded-lg border text-sm">
            {row.responses.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p>{r.criteria?.name ?? "Kriteria"}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.criteria?.category?.name ?? ""}
                    {r.comments ? ` · ${r.comments}` : ""}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">{r.rating}/5</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DecisionDialog({ pending, onClose }: { pending: Pending; onClose: (done: boolean) => void }) {
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pending?.action === "reject" ? "Kembalikan Penilaian" : "Setujui Penilaian"}</DialogTitle>
        </DialogHeader>
        {pending ? <DecisionBody key={pending.ids.join()} pending={pending} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DecisionBody({ pending, onClose }: { pending: NonNullable<Pending>; onClose: (done: boolean) => void }) {
  const [note, setNote] = useState("");
  const decide = useDecideFeedback();
  const reject = pending.action === "reject";

  function handleConfirm() {
    if (reject && !note.trim()) {
      toast.error("Alasan pengembalian wajib diisi");
      return;
    }
    const decision = reject
      ? { action: "reject" as const, assignment_ids: pending.ids, rejection_reason: note.trim() }
      : { action: "approve" as const, assignment_ids: pending.ids, comments: note.trim() || undefined };
    decide.mutate(decision, {
      onSuccess: () => {
        toast.success(reject ? "Penilaian dikembalikan ke karyawan" : `${pending.ids.length} penilaian disetujui`);
        onClose(true);
      },
      onError: (err) => toast.error(err.message || "Gagal menyimpan keputusan"),
    });
  }

  return (
    <>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {reject
            ? "Karyawan bisa memperbaiki penilaiannya lalu mengirim ulang."
            : `${pending.ids.length} penilaian akan disetujui dan hasil karyawannya dikunci.`}
        </p>
        <label htmlFor="decision-note" className="block text-xs font-medium text-muted-foreground">
          {reject ? "Alasan pengembalian" : "Catatan (opsional)"}
        </label>
        <Textarea id="decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onClose(false)}>
          Batal
        </Button>
        <Button onClick={handleConfirm} disabled={decide.isPending}>
          {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : reject ? "Kembalikan" : "Setujui"}
        </Button>
      </DialogFooter>
    </>
  );
}
