"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/datepicker";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { useCreateTask } from "../mutations";
import { DAY_NAMES_ID, PRIORITY_LABEL, RECURRENCE_LABEL, type TaskMeta, type TaskPriority, type TaskRecurrence } from "../types";

/** Form task departemen: rutin atau sekali jalan, PJ, prioritas, KPI, sub-task. */
export function TaskFormDialog({ meta, departmentId, onClose }: { meta: TaskMeta; departmentId: string; onClose: () => void }) {
  const create = useCreateTask();
  const [form, setForm] = useState({
    title: "",
    description: "",
    assignee: "",
    recurrence: "daily" as TaskRecurrence,
    weekly_day: "1",
    monthly_day: "1",
    due_date: meta.today,
    priority: "normal" as TaskPriority,
    indicator: "",
    contribution: "",
    subtasks: "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));
  const members = meta.members.filter((m) => m.department_id === departmentId);
  const indicators = meta.indicators.filter((i) => i.department_ids.length === 0 || i.department_ids.includes(departmentId));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              {
                department_id: departmentId,
                title: form.title.trim(),
                description: form.description.trim() || null,
                assignee_employee_id: form.assignee || null,
                recurrence: form.recurrence,
                weekly_day: form.recurrence === "weekly" ? Number(form.weekly_day) : null,
                monthly_day: form.recurrence === "monthly" ? Number(form.monthly_day) : null,
                due_date: form.recurrence === "once" ? form.due_date : null,
                priority: form.priority,
                kpi_indicator_id: form.indicator || null,
                kpi_contribution: form.contribution === "" ? null : Number(form.contribution),
                subtasks: form.subtasks
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((title) => ({ title })),
              },
              { onSuccess: onClose }
            );
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Task departemen baru</DialogPanelTitle>
            <DialogPanelDescription>Task rutin dijadwalkan sejak hari ini; sub-task berbobot menentukan progres.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Judul" className="sm:col-span-2">
              <Input value={form.title} onChange={set("title")} required minLength={3} maxLength={200} autoFocus />
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
            <Field label="Pengulangan">
              <select className={SELECT} value={form.recurrence} onChange={set("recurrence")}>
                {(Object.keys(RECURRENCE_LABEL) as TaskRecurrence[]).map((r) => (
                  <option key={r} value={r}>
                    {RECURRENCE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            {form.recurrence === "weekly" && (
              <Field label="Hari">
                <select className={SELECT} value={form.weekly_day} onChange={set("weekly_day")}>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <option key={d} value={d}>
                      {DAY_NAMES_ID[d]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {form.recurrence === "monthly" && (
              <Field label="Tanggal (1–28)">
                <Input type="number" min={1} max={28} value={form.monthly_day} onChange={set("monthly_day")} />
              </Field>
            )}
            {form.recurrence === "once" && (
              <Field label="Jatuh tempo">
                <DatePicker value={form.due_date} onChange={(v) => setForm((cur) => ({ ...cur, due_date: v || meta.today }))} showClear={false} />
              </Field>
            )}
            <Field label="Prioritas">
              <select className={SELECT} value={form.priority} onChange={set("priority")}>
                {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
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
            <Field label="Kontribusi ke indikator" hint="Dicatat ke KPI saat kemunculan disetujui.">
              <Input type="number" step="any" inputMode="decimal" value={form.contribution} onChange={set("contribution")} disabled={!form.indicator} />
            </Field>
            <Field label="Deskripsi" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.description} onChange={set("description")} />
            </Field>
            <Field label="Sub-task" hint="Satu butir per baris; bobot dibagi rata." className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.subtasks} onChange={set("subtasks")} />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={form.title.trim().length < 3 || create.isPending}>
              {create.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
