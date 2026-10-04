"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateDeptTask } from "../mutations";
import type { DeptTaskRecurrence } from "../types";
import { HARI, RECURRENCE_LABEL } from "./dept-task-meta";

interface DeptTaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departmentId?: string;
  members: { id: string; full_name: string }[];
}

/** Form "Tambah Task Departemen" (rutin atau sekali jalan, opsional sub-task). */
export function DeptTaskFormDialog({ open, onOpenChange, departmentId, members }: DeptTaskFormDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [recurrence, setRecurrence] = useState<DeptTaskRecurrence>("daily");
  const [weeklyDay, setWeeklyDay] = useState("1");
  const [monthlyDay, setMonthlyDay] = useState("1");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [subtasks, setSubtasks] = useState<{ title: string }[]>([]);
  const create = useCreateDeptTask();
  const filledSubtasks = subtasks.filter((st) => st.title.trim());

  function submit() {
    create.mutate(
      {
        department_id: departmentId,
        title,
        description: description || null,
        recurrence,
        weekly_day: recurrence === "weekly" ? Number(weeklyDay) : null,
        monthly_day: recurrence === "monthly" ? Number(monthlyDay) : null,
        due_date: recurrence === "once" ? dueDate : null,
        assignee_employee_id: assignee || null,
        subtasks: filledSubtasks.map((st) => ({ title: st.title.trim() })),
      },
      {
        onSuccess: () => {
          toast.success("Task dibuat");
          onOpenChange(false);
          setTitle("");
          setDescription("");
          setDueDate("");
          setAssignee("");
          setSubtasks([]);
        },
        onError: (err) => toast.error(err.message || "Gagal membuat task"),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah Task Departemen</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Judul task</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Cek suhu chiller" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Deskripsi (opsional)</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Pengulangan</label>
            <div className="mt-1 flex gap-1.5">
              {(["daily", "weekly", "monthly", "once"] as const).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={recurrence === r ? "default" : "outline"}
                  onClick={() => setRecurrence(r)}
                >
                  {RECURRENCE_LABEL[r]}
                </Button>
              ))}
            </div>
          </div>
          {recurrence === "weekly" ? (
            <div>
              <label className="text-xs font-medium text-gray-600">Setiap hari</label>
              <Combobox
                value={weeklyDay}
                onChange={setWeeklyDay}
                options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: HARI[d] }))}
              />
            </div>
          ) : null}
          {recurrence === "monthly" ? (
            <div>
              <label className="text-xs font-medium text-gray-600">Setiap tanggal (1–28)</label>
              <Input
                type="number"
                min={1}
                max={28}
                value={monthlyDay}
                onChange={(e) => setMonthlyDay(e.target.value)}
              />
            </div>
          ) : null}
          {recurrence === "once" ? (
            <div>
              <label className="text-xs font-medium text-gray-600">Jatuh tempo</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          ) : null}
          <div>
            <label className="text-xs font-medium text-gray-600">Sub-task (opsional)</label>
            <div className="mt-1 space-y-1.5">
              {subtasks.map((st, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    value={st.title}
                    placeholder={`Sub-task ${i + 1}`}
                    onChange={(e) =>
                      setSubtasks((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))
                      )
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2 text-red-500"
                    onClick={() => setSubtasks((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSubtasks((prev) => [...prev, { title: "" }])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Sub-task
                </Button>
                {filledSubtasks.length > 0 ? (
                  <span className="text-xs text-gray-500">{filledSubtasks.length} sub-task</span>
                ) : null}
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">
              Penanggung jawab (opsional — kosong = seluruh departemen)
            </label>
            <Combobox
              value={assignee}
              onChange={setAssignee}
              options={members.map((m) => ({ value: m.id, label: m.full_name }))}
              placeholder="Pilih karyawan…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Batal
          </Button>
          <Button onClick={submit} disabled={create.isPending || title.trim().length < 3}>
            {create.isPending ? "Menyimpan…" : "Simpan Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
