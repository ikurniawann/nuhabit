"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogPanel, DialogPanelBody, DialogPanelDescription, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCan } from "@/components/iam/iam-access-provider";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EVENTS_KEYS, eventsApi, TASK_KIND_LABEL, type EventSource, type EventTask, type TaskKind } from "../api";
import { SELECT_CLASS, useCalendarOptions } from "./event-place-fields";

/** Menu IAM yang izin create/update-nya membuka tulis checklist (guard /api/events/tasks). */
const MANAGE_MENUS = ["crm.engagement", "site.events"] as const;

/** Checklist persiapan event: venue, sponsor, promo, peralatan, dengan penanggung jawab dan tenggat. */
export function EventChecklistDialog({
  source,
  eventId,
  title,
  onClose,
}: {
  source: EventSource;
  eventId: string;
  title: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const key = EVENTS_KEYS.tasks(source, eventId);
  const tasks = useQuery({ queryKey: key, queryFn: () => eventsApi.tasks(source, eventId) });
  const options = useCalendarOptions();
  const canUpdate = useCan(MANAGE_MENUS, "update");
  const canCreate = useCan(MANAGE_MENUS, "create");
  const canManage = canUpdate || canCreate;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });

  const [draft, setDraft] = useState({ kind: "venue" as TaskKind, title: "", assignee_user_id: "", due_at: "" });
  const add = useMutation({
    mutationFn: () =>
      eventsApi.addTask(source, eventId, {
        kind: draft.kind,
        title: draft.title.trim(),
        assignee_user_id: draft.assignee_user_id || null,
        due_at: draft.due_at ? new Date(draft.due_at).toISOString() : null,
      }),
    onSuccess: () => {
      setDraft((d) => ({ ...d, title: "", due_at: "" }));
      refresh();
    },
    onError: (error) => toast.error("Tugas gagal ditambahkan", { description: error.message }),
  });
  const toggle = useMutation({
    mutationFn: (t: EventTask) => eventsApi.patchTask(t.id, { done: t.done_at === null }),
    onSuccess: refresh,
    onError: (error) => toast.error("Status tugas gagal diubah", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => eventsApi.removeTask(id),
    onSuccess: refresh,
    onError: (error) => toast.error("Tugas gagal dihapus", { description: error.message }),
  });

  const rows = tasks.data ?? [];
  const done = rows.filter((t) => t.done_at).length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Checklist {title}</DialogPanelTitle>
          <DialogPanelDescription>
            {rows.length === 0 ? "Belum ada tugas." : `${done} dari ${rows.length} tugas selesai.`} Penanggung jawab tugas ikut
            menerima notifikasi dan pengingat event.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {canManage && (
            <form
              className="grid grid-cols-1 gap-3 rounded-2xl bg-surface p-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <Field label="Tugas" className="sm:col-span-2">
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Konfirmasi banner sponsor"
                  maxLength={200}
                />
              </Field>
              <Field label="Jenis">
                <select className={SELECT_CLASS} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as TaskKind })}>
                  {(Object.keys(TASK_KIND_LABEL) as TaskKind[]).map((k) => (
                    <option key={k} value={k}>
                      {TASK_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Penanggung jawab">
                <select
                  className={SELECT_CLASS}
                  value={draft.assignee_user_id}
                  onChange={(e) => setDraft({ ...draft, assignee_user_id: e.target.value })}
                >
                  <option value="">Belum ditentukan</option>
                  {(options.data?.staff ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tenggat">
                <Input type="datetime-local" value={draft.due_at} onChange={(e) => setDraft({ ...draft, due_at: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={draft.title.trim().length < 2 || add.isPending}>
                  <Plus /> Tambah tugas
                </Button>
              </div>
            </form>
          )}

          {tasks.isLoading ? (
            <TableNote>Memuat checklist…</TableNote>
          ) : tasks.error ? (
            <TableNote tone="danger">{tasks.error.message}</TableNote>
          ) : rows.length === 0 ? (
            <TableNote>Tambahkan tugas venue, sponsor, promo, atau peralatan.</TableNote>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((t) => {
                const overdue = !t.done_at && t.due_at !== null && new Date(t.due_at) < new Date();
                return (
                  <li key={t.id} className="flex items-start gap-3 py-3">
                    <button
                      type="button"
                      className="mt-0.5 shrink-0 text-forest disabled:opacity-50"
                      aria-label={t.done_at ? "Tandai belum selesai" : "Tandai selesai"}
                      disabled={!canManage || toggle.isPending}
                      onClick={() => toggle.mutate(t)}
                    >
                      {t.done_at ? <CheckCircle2 className="size-5" /> : <Circle className="size-5 text-muted-foreground" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-medium", t.done_at && "text-muted-foreground line-through")}>{t.title}</p>
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <Badge variant="outline">{TASK_KIND_LABEL[t.kind]}</Badge>
                        <span>{t.assignee_name ?? "Belum ada penanggung jawab"}</span>
                        {t.due_at && <span className={cn(overdue && "font-medium text-danger")}>Tenggat {formatDateTime(t.due_at)}</span>}
                      </p>
                    </div>
                    {canManage && (
                      <Button variant="ghost" size="icon-xs" aria-label="Hapus tugas" onClick={() => remove.mutate(t.id)}>
                        <Trash2 />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
