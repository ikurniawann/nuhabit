"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateTask, useUpdateTask } from "../queries";
import {
  EMPTY_TASK_FORM,
  PRIORITY_LABELS,
  RECURRENCE_LABELS,
  STATUS_LABELS,
  SUBJECT_LABELS,
  TASK_TYPE_LABELS,
  formToPayload,
  taskToForm,
  type SalesTask,
  type TaskFormValues,
  type TaskSubjectRef,
} from "../types";

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** wajib untuk mode tambah */
  subject?: TaskSubjectRef | null;
  /** null = tambah; terisi = edit */
  task?: SalesTask | null;
  /** nilai awal (mis. klik tanggal di kalender) */
  defaultDueAt?: string;
}

const CHANNELS: Array<{ value: "wa" | "in_app"; label: string }> = [
  { value: "wa", label: "WhatsApp" },
  { value: "in_app", label: "Notifikasi aplikasi" },
];

/** EPIC-050 T-1.5 — form task: judul, jenis, jatuh tempo, pengingat, prioritas, status, rekurensi. */
export function TaskFormDialog({ open, onOpenChange, subject, task, defaultDueAt }: TaskFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {open ? (
          <TaskFormBody
            key={task?.id ?? `new-${subject?.subject_id ?? ""}-${defaultDueAt ?? ""}`}
            onOpenChange={onOpenChange}
            subject={subject}
            task={task}
            defaultDueAt={defaultDueAt}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskFormBody({ onOpenChange, subject, task, defaultDueAt }: Omit<TaskFormDialogProps, "open">) {
  // State diinisialisasi sekali per mount; remount via `key` saat task/subject berganti.
  const [form, setForm] = useState<TaskFormValues>(() =>
    task ? taskToForm(task) : { ...EMPTY_TASK_FORM, due_at: defaultDueAt ?? "" }
  );
  const isEdit = Boolean(task);

  const close = () => onOpenChange(false);
  const createMutation = useCreateTask(close);
  const updateMutation = useUpdateTask(close);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const needsDue = Boolean(form.recurrence_freq);
  const canSubmit =
    (form.title.trim() || form.notes.trim()) && (!needsDue || form.due_at) && (isEdit || subject);

  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    if (isEdit && task) {
      updateMutation.mutate({ id: task.id, values: formToPayload(form) });
    } else if (subject) {
      createMutation.mutate({ subject, values: form });
    }
  };

  const subjectLabel = task?.subject_name ?? subject?.label ?? null;
  const subjectType = task?.subject_type ?? subject?.subject_type ?? null;

  return (
    <>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Task" : "Tambah Task"}</DialogTitle>
        </DialogHeader>

        {subjectType ? (
          <p className="-mt-2 text-xs text-gray-500">
            Untuk {SUBJECT_LABELS[subjectType]}
            {subjectLabel ? `: ${subjectLabel}` : ""}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="task_title">Judul</Label>
            <Input
              id="task_title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="cth. Kirim proposal, telepon PIC, survey lokasi"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Jenis</Label>
            <Select value={form.activity_type} onValueChange={(v) => set("activity_type", v as TaskFormValues["activity_type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Prioritas</Label>
            <Select value={form.priority} onValueChange={(v) => set("priority", v as TaskFormValues["priority"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task_due">Jatuh tempo{needsDue ? " *" : ""}</Label>
            <Input
              id="task_due"
              type="datetime-local"
              value={form.due_at}
              onChange={(e) => set("due_at", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task_reminder">Pengingat (opsional)</Label>
            <Input
              id="task_reminder"
              type="datetime-local"
              value={form.reminder_at}
              onChange={(e) => set("reminder_at", e.target.value)}
            />
            <p className="text-[11px] text-gray-500">Kosong = diingatkan saat jatuh tempo.</p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Kanal pengingat</Label>
            <div className="flex flex-wrap gap-4 pt-1">
              {CHANNELS.map((channel) => {
                const checked = form.reminder_channels.includes(channel.value);
                return (
                  <label key={channel.value} className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        set(
                          "reminder_channels",
                          value
                            ? [...form.reminder_channels, channel.value]
                            : form.reminder_channels.filter((c) => c !== channel.value)
                        )
                      }
                    />
                    {channel.label}
                  </label>
                );
              })}
              <span className="text-xs text-gray-400">Email menyusul (Fase 7)</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Ulangi</Label>
            <Select
              value={form.recurrence_freq || "none"}
              onValueChange={(v) => set("recurrence_freq", v === "none" ? "" : (v as TaskFormValues["recurrence_freq"]))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Tidak berulang</SelectItem>
                {Object.entries(RECURRENCE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.recurrence_freq ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="task_interval">Setiap (interval)</Label>
                <Input
                  id="task_interval"
                  type="number"
                  min={1}
                  max={52}
                  value={form.recurrence_interval}
                  onChange={(e) => set("recurrence_interval", Number(e.target.value) || 1)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task_until">Sampai (opsional)</Label>
                <Input
                  id="task_until"
                  type="date"
                  value={form.recurrence_until}
                  onChange={(e) => set("recurrence_until", e.target.value)}
                />
              </div>
            </>
          ) : null}

          {isEdit ? (
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as TaskFormValues["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="task_notes">Catatan</Label>
            <Textarea
              id="task_notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              placeholder="Detail yang perlu diingat saat mengerjakan"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={isPending}>Batal</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
            {isPending ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Tambah Task"}
          </Button>
        </DialogFooter>
    </>
  );
}
