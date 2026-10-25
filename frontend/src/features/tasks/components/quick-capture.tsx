"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateTask } from "../mutations";
import { parseQuickCapture, quickCapturePayload } from "../quick-capture";
import { RECURRENCE_LABEL, type TaskMeta } from "../types";

/**
 * Satu kotak untuk menambah tugas pribadi: ketik, Enter. Kata penanda di
 * akhir ("besok", "jumat", "setiap hari", "!", "!!") jadi tanggal, kadens
 * dan prioritas. Fokus tetap di kotak agar bisa menambah beruntun.
 */
export function QuickCapture({ meta }: { meta: TaskMeta }) {
  const [text, setText] = useState("");
  const create = useCreateTask();
  const parsed = parseQuickCapture(text, meta.today);
  const linked = !!meta.me.employee_id && !!meta.me.department_id;

  const submit = () => {
    if (!parsed || create.isPending || !linked) return;
    create.mutate(quickCapturePayload(parsed, meta.me.employee_id, meta.me.department_id), { onSuccess: () => setText("") });
  };

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <Input
          aria-label="Tambah tugas"
          placeholder="Tambah tugas… misal: Kirim laporan stok besok !!"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-11 flex-1"
          autoComplete="off"
          disabled={!linked}
        />
        <Button type="submit" disabled={!parsed || create.isPending || !linked} aria-label="Simpan tugas">
          <Plus /> <span className="hidden sm:inline">Tambah</span>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {!linked
          ? "Akun Anda belum terhubung ke data karyawan dan departemen. Hubungi HRD untuk bisa menambah tugas."
          : parsed && (parsed.due_date !== meta.today || parsed.priority || parsed.recurrence !== "once")
            ? [
                parsed.recurrence !== "once" ? `kadens ${RECURRENCE_LABEL[parsed.recurrence].toLowerCase()}` : `jatuh tempo ${parsed.due_date}`,
                parsed.priority ? `prioritas ${parsed.priority}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Enter untuk menyimpan. Penanda: besok, lusa, nama hari, setiap hari/minggu/bulan, ! atau !!"}
      </p>
    </form>
  );
}
