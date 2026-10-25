"use client";

import { useState } from "react";
import { CheckCircle2, Download, Paperclip, Play, RotateCcw, Trash2, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { formatDate, formatDateTime } from "@/lib/format";
import { attachmentUrl } from "../api";
import { useAttachments, useOccurrenceAction, usePatchTask } from "../mutations";
import { useOccurrence, useTaskMeta } from "../queries";
import {
  DAY_NAMES_ID,
  PRIORITY_LABEL,
  RECURRENCE_LABEL,
  STATUS_LABEL,
  type OccurrenceStatus,
  type TaskDetail,
  type TaskPriority,
  type TaskUpdate,
} from "../types";
import { PriorityBadge, StatusBadge } from "./task-badges";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function updateLine(u: TaskUpdate): string {
  const who = u.author_name ?? "Sistem";
  const status = typeof u.detail.status === "string" ? (STATUS_LABEL[u.detail.status as OccurrenceStatus] ?? u.detail.status) : "";
  switch (u.kind) {
    case "progress":
      return u.progress_percent !== null ? `${who} mencatat progres ${u.progress_percent}%` : `${who} mencatat progres`;
    case "comment":
      return `${who} berkomentar`;
    case "status":
      return `${who} mengubah status → ${status}`;
    case "review":
      return `${who} mereview → ${status}`;
    case "attachment":
      return `${who} melampirkan ${typeof u.detail.name === "string" ? u.detail.name : "file"}`;
    default:
      return `${who} membuat tugas`;
  }
}

/** Panel detail satu kemunculan: sub-task, progres, aksi, komentar, lampiran, riwayat. */
export function TaskDetailSheet({ occurrenceId, onClose }: { occurrenceId: string | null; onClose: () => void }) {
  const detail = useOccurrence(occurrenceId);
  return (
    <Sheet open={!!occurrenceId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        {detail.isLoading || !occurrenceId ? (
          <SheetHeader>
            <SheetTitle>Memuat tugas…</SheetTitle>
            <SheetDescription>Detail tugas sedang dimuat.</SheetDescription>
          </SheetHeader>
        ) : detail.error || !detail.data ? (
          <SheetHeader>
            <SheetTitle>Tugas tidak ditemukan</SheetTitle>
            <SheetDescription>{detail.error?.message ?? "Tugas ini di luar jangkauan Anda."}</SheetDescription>
          </SheetHeader>
        ) : (
          <TaskDetailBody key={detail.data.occurrence_id} item={detail.data} onDeactivated={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TaskDetailBody({ item, onDeactivated }: { item: TaskDetail; onDeactivated: () => void }) {
  const act = useOccurrenceAction();
  const patch = usePatchTask();
  const files = useAttachments(item.occurrence_id);
  const meta = useTaskMeta();
  const [note, setNote] = useState("");
  const [percent, setPercent] = useState(item.progress_percent !== null ? String(item.progress_percent) : "");
  const [comment, setComment] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const run = (body: Parameters<typeof act.mutate>[0]["body"], after?: () => void) =>
    act.mutate({ id: item.occurrence_id, body }, { onSuccess: after });
  const open = item.status === "pending" || item.status === "in_progress" || item.status === "rejected";
  const canApprove = item.can_review && item.status === "done";
  // The worker takes back a row they sent for review (or closed, for a
  // personal task); only a reviewer takes back an approved department row.
  const canReopen =
    (item.status === "done" && (item.can_review || item.can_work)) ||
    (item.status === "approved" && (item.can_review || (item.can_work && !item.review_required)));
  const members = (meta.data?.members ?? []).filter((m) => m.department_id === item.department_id);
  const indicators = meta.data?.indicators ?? [];

  return (
    <div className="space-y-5 pb-6">
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2 pr-8">
          {item.title}
          <PriorityBadge priority={item.priority} />
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} overdue={item.overdue} />
          <span>{formatDate(item.occurrence_date)}</span>
          <span>· {item.department_name}</span>
          <span>· PJ {item.assignee_name ?? "departemen"}</span>
          {item.recurrence !== "once" && (
            <span>
              · {RECURRENCE_LABEL[item.recurrence]}
              {item.weekly_day ? ` (${DAY_NAMES_ID[item.weekly_day]})` : item.monthly_day ? ` (tgl ${item.monthly_day})` : ""}
            </span>
          )}
          {!item.review_required && <Badge variant="outline">Tugas pribadi</Badge>}
        </SheetDescription>
      </SheetHeader>

      {item.description && <p className="whitespace-pre-wrap text-sm text-body">{item.description}</p>}
      {item.kpi_indicator_name && (
        <p className="text-xs text-muted-foreground">
          Indikator KPI: <span className="font-medium text-foreground">{item.kpi_indicator_name}</span>
          {item.kpi_contribution !== null ? ` · kontribusi ${item.kpi_contribution}` : ""}
          {item.contribution ? ` · tercatat ${item.contribution.period_month}/${item.contribution.period_year}` : ""}
        </p>
      )}
      {item.status === "rejected" && item.review_notes && (
        <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">Ditolak: {item.review_notes}</p>
      )}

      <div className="flex items-center gap-2">
        <Progress value={item.progress} aria-label="Progres" className="h-2 flex-1" />
        <span className="w-10 text-right text-xs tabular-nums">{item.progress}%</span>
      </div>

      {item.subtasks.length > 0 && (
        <section aria-labelledby="task-subtasks">
          <h3 id="task-subtasks" className="mb-2 text-sm font-semibold">
            Sub-task
          </h3>
          <ul className="space-y-1.5">
            {item.subtasks.map((st) => (
              <li key={st.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label={st.title}
                  checked={st.is_checked}
                  disabled={!item.can_work || item.status === "approved" || act.isPending}
                  onCheckedChange={(checked) => run({ action: "check_subtask", subtask_id: st.id, checked: !!checked })}
                />
                <span className={st.is_checked ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{st.title}</span>
                <span className="text-xs text-muted-foreground">{Math.round(st.weight)}%</span>
                {st.checked_by_name && <span className="text-xs text-muted-foreground">{st.checked_by_name}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {item.can_work && open && (
        <section aria-labelledby="task-progress" className="rounded-2xl bg-surface p-3">
          <h3 id="task-progress" className="mb-2 text-sm font-semibold">
            Update progres
          </h3>
          <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
            {item.subtasks.length === 0 ? (
              <Field label="Progres (%)">
                <Input type="number" min={0} max={99} inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="0–99" />
              </Field>
            ) : (
              <p className="self-end text-xs text-muted-foreground">Progres dari ceklis sub-task.</p>
            )}
            <Field label="Catatan progres">
              <Input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="mis. 2 dari 3 lokasi sudah dicek" />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="soft"
              size="sm"
              disabled={act.isPending || (!note.trim() && percent === "")}
              onClick={() =>
                run(
                  {
                    action: "progress",
                    note: note.trim() || null,
                    progress_percent: item.subtasks.length === 0 && percent !== "" ? Number(percent) : null,
                  },
                  () => setNote("")
                )
              }
            >
              Simpan progres
            </Button>
            {item.status === "pending" && (
              <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => run({ action: "start" })}>
                <Play /> Mulai
              </Button>
            )}
            {item.subtasks.length === 0 && (
              <Button size="sm" disabled={act.isPending} onClick={() => run({ action: "done" })}>
                <CheckCircle2 /> {item.review_required ? "Tandai selesai" : "Selesai"}
              </Button>
            )}
          </div>
        </section>
      )}

      {canApprove || canReopen ? (
        <section aria-labelledby="task-review" className="flex flex-wrap items-center gap-2">
          <h3 id="task-review" className="sr-only">
            Review
          </h3>
          {canApprove && (
            <>
              <Button size="sm" disabled={act.isPending} onClick={() => run({ action: "approve" })}>
                <CheckCircle2 /> Setujui
              </Button>
              <Button variant="outline" size="sm" className="text-danger" disabled={act.isPending} onClick={() => setRejecting((v) => !v)}>
                <XCircle /> Tolak
              </Button>
            </>
          )}
          {canReopen && (
            <Button variant="ghost" size="sm" disabled={act.isPending} onClick={() => run({ action: "reopen" })}>
              <RotateCcw /> Buka lagi
            </Button>
          )}
          {rejecting && (
            <form
              className="flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run({ action: "reject", notes: rejectNote.trim() || null }, () => {
                  setRejecting(false);
                  setRejectNote("");
                });
              }}
            >
              <Input aria-label="Alasan penolakan" placeholder="Alasan penolakan (opsional)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
              <Button type="submit" variant="destructive" size="sm" disabled={act.isPending}>
                Kirim balik
              </Button>
            </form>
          )}
        </section>
      ) : null}

      <section aria-labelledby="task-attachments">
        <h3 id="task-attachments" className="mb-2 text-sm font-semibold">
          Lampiran
        </h3>
        <ul className="space-y-1.5">
          {item.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <Paperclip className="size-4 text-muted-foreground" aria-hidden />
              <a href={attachmentUrl(item.occurrence_id, a.id)} className="min-w-0 flex-1 truncate text-brand-text underline-offset-4 hover:underline">
                {a.name}
              </a>
              <span className="text-xs text-muted-foreground">{formatBytes(a.size_bytes)}</span>
              <a href={attachmentUrl(item.occurrence_id, a.id)} aria-label={`Unduh ${a.name}`} className="text-muted-foreground hover:text-foreground">
                <Download className="size-4" />
              </a>
              {(a.uploaded_by_user_id === meta.data?.me.user_id || item.can_manage) && (
                <Button variant="ghost" size="icon-xs" aria-label={`Hapus lampiran ${a.name}`} onClick={() => files.remove.mutate(a.id)}>
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {(item.can_work || item.can_manage) && (
          <label className="mt-2 inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-dashed border-border px-4 text-sm hover:bg-surface">
            <input
              type="file"
              className="sr-only"
              disabled={files.upload.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) files.upload.mutate(file);
              }}
            />
            <Paperclip className="size-4" aria-hidden />
            {files.upload.isPending ? "Mengunggah…" : "Unggah file (maks. 10 MB)"}
          </label>
        )}
      </section>

      <section aria-labelledby="task-comments">
        <h3 id="task-comments" className="mb-2 text-sm font-semibold">
          Komentar & catatan
        </h3>
        <ul className="space-y-2">
          {[...item.updates]
            .reverse()
            .filter((u) => u.note)
            .map((u) => (
              <li key={u.id} className="rounded-xl bg-surface px-3 py-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  {u.author_name ?? "Sistem"} · {formatDateTime(u.created_at)}
                  {u.kind === "progress" && u.progress_percent !== null ? ` · progres ${u.progress_percent}%` : ""}
                  {u.kind === "review" ? " · review" : ""}
                </p>
                <p className="whitespace-pre-wrap">{u.note}</p>
              </li>
            ))}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!comment.trim()) return;
            run({ action: "comment", note: comment.trim() }, () => setComment(""));
          }}
        >
          <Input aria-label="Komentar baru" placeholder="Tulis komentar…" value={comment} onChange={(e) => setComment(e.target.value)} />
          <Button type="submit" variant="soft" disabled={!comment.trim() || act.isPending}>
            Kirim
          </Button>
        </form>
      </section>

      <section aria-labelledby="task-activity">
        <h3 id="task-activity" className="mb-2 text-sm font-semibold">
          Riwayat
        </h3>
        <ol className="space-y-1 text-xs text-muted-foreground">
          {item.updates.map((u) => (
            <li key={u.id}>
              {formatDateTime(u.created_at)} · {updateLine(u)}
            </li>
          ))}
          {item.updates.length === 0 && <li>Belum ada aktivitas.</li>}
        </ol>
      </section>

      {item.can_manage && (
        <section aria-labelledby="task-manage" className="border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <h3 id="task-manage" className="text-sm font-semibold">
              Pengaturan task
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? "Tutup" : "Ubah"}
            </Button>
          </div>
          {editing && <TaskEditForm item={item} members={members} indicators={indicators} onSave={(p) => patch.mutate({ id: item.task_id, patch: p })} saving={patch.isPending} />}
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDeactivate(true)}>
              <Trash2 /> Nonaktifkan task
            </Button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title="Nonaktifkan task?"
        description={`"${item.title}" tidak dijadwalkan lagi. Kemunculan yang sudah ada tetap tersimpan.`}
        confirmLabel="Nonaktifkan"
        variant="danger"
        loading={patch.isPending}
        onConfirm={() =>
          patch.mutate(
            { id: item.task_id, patch: { is_active: false } },
            {
              onSuccess: () => {
                setConfirmDeactivate(false);
                onDeactivated();
              },
            }
          )
        }
      />
    </div>
  );
}

function TaskEditForm({
  item,
  members,
  indicators,
  onSave,
  saving,
}: {
  item: TaskDetail;
  members: { id: string; full_name: string }[];
  indicators: { id: string; name: string }[];
  onSave: (p: { title: string; description: string | null; priority: TaskPriority; assignee_employee_id: string | null; kpi_indicator_id: string | null; kpi_contribution: number | null }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    title: item.title,
    description: item.description,
    priority: item.priority,
    assignee: item.assignee_employee_id ?? "",
    indicator: item.kpi_indicator_id ?? "",
    contribution: item.kpi_contribution !== null ? String(item.kpi_contribution) : "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          title: form.title.trim(),
          description: form.description.trim() || null,
          priority: form.priority,
          assignee_employee_id: form.assignee || null,
          kpi_indicator_id: form.indicator || null,
          kpi_contribution: form.contribution === "" ? null : Number(form.contribution),
        });
      }}
    >
      <Field label="Judul" className="sm:col-span-2">
        <Input value={form.title} onChange={set("title")} required minLength={3} maxLength={200} />
      </Field>
      <Field label="Prioritas">
        <select className={SELECT} value={form.priority} onChange={set("priority")}>
          {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Penanggung jawab">
        <select className={SELECT} value={form.assignee} onChange={set("assignee")}>
          <option value="">Seluruh departemen</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Indikator KPI">
        <select className={SELECT} value={form.indicator} onChange={set("indicator")}>
          <option value="">Tidak terkait KPI</option>
          {indicators.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Kontribusi ke indikator">
        <Input type="number" step="any" inputMode="decimal" value={form.contribution} onChange={set("contribution")} disabled={!form.indicator} />
      </Field>
      <Field label="Deskripsi" className="sm:col-span-2">
        <textarea className={TEXTAREA} value={form.description} onChange={set("description")} />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" size="sm" disabled={saving || form.title.trim().length < 3}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
