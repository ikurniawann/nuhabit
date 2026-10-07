"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { describeLeaveDays } from "@/lib/hris/holidays";
import { useHolidayIndex } from "@/features/hris/attendance/queries";
import { useSubmitMyLeave } from "../mutations";
import type { EssLeaveBalance, EssLeaveForm } from "../types";

export const LEAVE_TYPE_OPTIONS = [
  { value: "annual", label: "Cuti Tahunan" },
  { value: "sick", label: "Sakit" },
  { value: "emergency", label: "Izin Darurat" },
  { value: "unpaid", label: "Izin Tanpa Gaji" },
  { value: "maternity", label: "Cuti Melahirkan" },
  { value: "paternity", label: "Cuti Ayah" },
  { value: "menstrual", label: "Cuti Haid" },
  { value: "pilgrimage", label: "Ibadah" },
  { value: "marriage", label: "Menikah" },
  { value: "bereavement", label: "Duka" },
];

const EMPTY_LEAVE_FORM: EssLeaveForm = { leave_type: "annual", start_date: "", end_date: "", reason: "" };

interface CutiRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: EssLeaveBalance | null;
}

/** Form pengajuan izin/cuti mandiri (server memaksa employee_id = diri sendiri). */
export function CutiRequestDialog({ open, onOpenChange, balance }: CutiRequestDialogProps) {
  const [form, setForm] = useState(EMPTY_LEAVE_FORM);
  const [attachment, setAttachment] = useState<{ name: string; dataUrl: string } | null>(null);
  const submit = useSubmitMyLeave();

  /**
   * Pratinjau potongan jatah cuti (EPIC-036 Fase D). Angka yang mengikat tetap
   * dihitung ulang server saat disimpan; ini supaya karyawan tahu lebih dulu
   * kenapa cuti 5 hari kalender bisa hanya memotong 3 hari jatah.
   */
  const { start_date: start, end_date: end } = form;
  const validRange = Boolean(start && end && end >= start);
  const holidayIndex = useHolidayIndex(start, end, validRange).data;
  const leaveDays = validRange && holidayIndex ? describeLeaveDays(start, end, holidayIndex) : null;

  function handleAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Lampiran harus berupa gambar (foto surat dokter dsb.)");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Ukuran lampiran maksimal 5 MB");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setAttachment({ name: file.name, dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  }

  function handleSubmit() {
    if (!form.start_date || !form.end_date) {
      toast.error("Tanggal mulai dan selesai wajib diisi");
      return;
    }
    if (form.reason.trim().length < 10) {
      toast.error("Alasan minimal 10 karakter");
      return;
    }
    submit.mutate(
      { form, attachment: attachment?.dataUrl },
      {
        onSuccess: () => {
          toast.success("Pengajuan terkirim — menunggu persetujuan");
          onOpenChange(false);
          setForm(EMPTY_LEAVE_FORM);
          setAttachment(null);
        },
        onError: (error) => toast.error(error.message || "Gagal mengajukan"),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajukan Izin / Cuti</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Jenis</label>
            <Combobox
              options={LEAVE_TYPE_OPTIONS}
              value={form.leave_type}
              onChange={(value) => setForm((f) => ({ ...f, leave_type: value }))}
              placeholder="Pilih jenis"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Mulai</label>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Selesai</label>
              <Input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Alasan (min. 10 karakter)
            </label>
            <Input
              placeholder="cth. keperluan keluarga di luar kota"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Lampiran (ops. — foto surat dokter dsb., maks 5 MB)
            </label>
            <Input type="file" accept="image/*" onChange={handleAttachmentChange} />
            {attachment && <p className="mt-1 text-xs text-gray-500">📎 {attachment.name}</p>}
          </div>
          {/* Pratinjau potongan jatah (EPIC-036 Fase D): akhir pekan dan
              tanggal merah tidak memotong, cuti bersama tetap memotong. */}
          {leaveDays !== null && (
            <div
              className={`rounded-lg px-3 py-2 text-xs ${
                leaveDays.totalDays === 0
                  ? "bg-amber-50 text-amber-800"
                  : "bg-emerald-50 text-emerald-800"
              }`}
            >
              {leaveDays.totalDays === 0 ? (
                <p>
                  Rentang ini sudah libur seluruhnya
                  {leaveDays.excludedHolidays.length > 0 &&
                    ` (${leaveDays.excludedHolidays.map((h) => h.name).join(", ")})`}
                  {" "}— tidak perlu mengajukan cuti.
                </p>
              ) : (
                <>
                  <p className="font-semibold">Memotong jatah {leaveDays.totalDays} hari</p>
                  {leaveDays.excludedHolidays.length > 0 && (
                    <p className="mt-0.5">
                      Tidak dipotong: {leaveDays.excludedHolidays.map((h) => h.name).join(", ")}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {form.leave_type === "annual" && balance && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
              Sisa kuota cuti tahunan Anda: {Number(balance.annual_leave_remaining)} hari.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={submit.isPending}>
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kirim Pengajuan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
