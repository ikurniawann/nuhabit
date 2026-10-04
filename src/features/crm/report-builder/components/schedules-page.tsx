"use client";

import { useState } from "react";
import { ClockIcon } from "@heroicons/react/24/outline";
import { Loader2, Plus, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useOwners } from "@/features/crm/advance/queries";
import {
  DAY_NAMES, SCHEDULE_CHANNELS, SCHEDULE_CHANNEL_LABELS, SCHEDULE_FREQUENCIES, SCHEDULE_FREQUENCY_LABELS, describeSchedule,
} from "@/lib/crm/report-schedule";
import {
  useCreateSchedule, useDeleteSchedule, useRunScheduleNow, useSavedReports, useSchedules, useUpdateSchedule,
} from "../queries";
import type { ScheduleChannel, ScheduleFrequency, ScheduleInput, ScheduleRecipient, ScheduleRow } from "../types";
import { formatDateTime } from "@/lib/format";

/** EPIC-050 T-4.3 — Laporan Terjadwal: kirim ringkasan report lewat WA / notifikasi. */
export function ReportSchedulesPage() {
  const schedulesQuery = useSchedules();
  const reportsQuery = useSavedReports();
  const createMutation = useCreateSchedule();
  const updateMutation = useUpdateSchedule();
  const deleteMutation = useDeleteSchedule();
  const runNowMutation = useRunScheduleNow();
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<ScheduleRow | null>(null);
  const schedules = schedulesQuery.data ?? [];
  const reports = reportsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Laporan Terjadwal</h1>
          <p className="mt-1 text-sm text-gray-500">
            Kirim ringkasan report otomatis lewat WhatsApp atau notifikasi aplikasi. Pengiriman lewat email menyusul.
          </p>
        </div>
        <Button type="button" className="h-10 gap-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700" onClick={() => setFormOpen(true)} disabled={reports.length === 0}>
          <Plus className="h-4 w-4" /> Jadwal
        </Button>
      </div>

      <PurchasingListSection
        icon={ClockIcon}
        title="Daftar Jadwal"
        description="Pengecekan berjalan tiap 15 menit; jam mengikuti waktu WIB."
      >
        {schedulesQuery.isLoading ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : reports.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">Simpan report dulu di Report Builder, lalu jadwalkan di sini.</p>
        ) : schedules.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">Belum ada jadwal.</p>
        ) : (
          <ul className="divide-y divide-gray-200/60">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Switch checked={s.is_active} onCheckedChange={(v) => updateMutation.mutate({ id: s.id, values: { is_active: Boolean(v) } })} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{s.name} <span className="text-xs font-normal text-gray-400">· {s.report_name}</span></p>
                  <p className="text-xs text-gray-500">
                    {describeSchedule(s)} · {SCHEDULE_CHANNEL_LABELS[s.channel]} · {s.recipients.length} penerima
                    {s.is_active ? ` · berikutnya ${formatDateTime(s.next_run_at, "—")}` : ""}
                  </p>
                  {s.last_status === "error" ? <p className="text-xs text-red-600">Gagal terakhir: {s.last_error ?? "tidak diketahui"}</p> : null}
                </div>
                {s.last_run_at ? (
                  <Badge className={`border-0 font-normal ${s.last_status === "error" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                    terakhir {formatDateTime(s.last_run_at, "—")}
                  </Badge>
                ) : null}
                <button type="button" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-pink-700"
                  onClick={() => runNowMutation.mutate(s.id)} disabled={runNowMutation.isPending}>
                  <Send className="h-3.5 w-3.5" /> Kirim sekarang
                </button>
                <button type="button" className="text-xs text-gray-400 hover:text-red-600" onClick={() => setDeleting(s)}>Hapus</button>
              </li>
            ))}
          </ul>
        )}
      </PurchasingListSection>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          {formOpen ? (
            <ScheduleForm
              reports={reports.map((r) => ({ id: r.id, name: r.name }))}
              pending={createMutation.isPending}
              onCancel={() => setFormOpen(false)}
              onSubmit={(v) => createMutation.mutate(v, { onSuccess: () => setFormOpen(false) })}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus jadwal?"
        description={`"${deleting?.name ?? ""}" tidak akan dikirim lagi. Report tetap tersimpan.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null); }}
      />
    </div>
  );
}

function ScheduleForm({ reports, pending, onCancel, onSubmit }: {
  reports: Array<{ id: string; name: string }>;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: ScheduleInput) => void;
}) {
  const ownersQuery = useOwners();
  const [reportId, setReportId] = useState(reports[0]?.id ?? "");
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<ScheduleFrequency>("weekly");
  const [hour, setHour] = useState("8");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [channel, setChannel] = useState<ScheduleChannel>("wa");
  const [recipients, setRecipients] = useState<ScheduleRecipient[]>([]);
  const [userToAdd, setUserToAdd] = useState("");
  const [numberToAdd, setNumberToAdd] = useState("");
  const owners = ownersQuery.data ?? [];
  const canSubmit = reportId && name.trim() && recipients.length > 0;

  const addUser = (id: string) => {
    if (!id || recipients.some((r) => r.type === "user" && r.user_id === id)) return;
    setRecipients([...recipients, { type: "user", user_id: id }]);
    setUserToAdd("");
  };
  const addNumber = () => {
    const n = numberToAdd.trim();
    if (n.length < 8 || recipients.some((r) => r.type === "number" && r.number === n)) return;
    setRecipients([...recipients, { type: "number", number: n }]);
    setNumberToAdd("");
  };

  return (
    <>
      <DialogHeader><DialogTitle>Jadwal Baru</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label>Report</Label>
          <Select value={reportId} onValueChange={setReportId}>
            <SelectTrigger><SelectValue placeholder="pilih report" /></SelectTrigger>
            <SelectContent>{reports.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Nama jadwal</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Rekap pipeline Senin pagi" /></div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label>Frekuensi</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduleFrequency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SCHEDULE_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{SCHEDULE_FREQUENCY_LABELS[f]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {frequency === "weekly" ? (
            <div className="space-y-1.5">
              <Label>Hari</Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DAY_NAMES.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : frequency === "monthly" ? (
            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <Input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
            </div>
          ) : <div />}
          <div className="space-y-1.5">
            <Label>Jam (WIB)</Label>
            <Input type="number" min={0} max={23} value={hour} onChange={(e) => setHour(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Kanal</Label>
          <Select value={channel} onValueChange={(v) => setChannel(v as ScheduleChannel)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SCHEDULE_CHANNELS.map((c) => <SelectItem key={c} value={c}>{SCHEDULE_CHANNEL_LABELS[c]}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs text-gray-500">WhatsApp mengirim ke nomor karyawan penerima sekaligus notifikasi aplikasi.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Penerima</Label>
          <div className="flex flex-wrap gap-1.5">
            {recipients.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
                {r.type === "user" ? owners.find((o) => o.id === r.user_id)?.full_name ?? "Pengguna" : r.number}
                <button type="button" onClick={() => setRecipients(recipients.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
              </span>
            ))}
            {recipients.length === 0 ? <span className="text-xs text-gray-500">Belum ada penerima.</span> : null}
          </div>
          <div className="flex gap-1.5">
            <Select value={userToAdd} onValueChange={addUser}>
              <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="+ pengguna" /></SelectTrigger>
              <SelectContent>{owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {channel === "wa" ? (
            <div className="flex gap-1.5">
              <Input className="h-9" value={numberToAdd} onChange={(e) => setNumberToAdd(e.target.value)} placeholder="+ nomor WA, cth. 08123456789" />
              <Button type="button" size="sm" variant="outline" className="h-9" onClick={addNumber}>Tambah</Button>
            </div>
          ) : null}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>Batal</Button>
        <Button
          disabled={!canSubmit || pending}
          onClick={() =>
            onSubmit({
              report_id: reportId,
              name: name.trim(),
              frequency,
              hour: Math.min(23, Math.max(0, Number(hour) || 0)),
              day_of_week: frequency === "weekly" ? Number(dayOfWeek) : null,
              day_of_month: frequency === "monthly" ? Math.min(28, Math.max(1, Number(dayOfMonth) || 1)) : null,
              channel,
              recipients,
              is_active: true,
            })
          }
        >
          {pending ? "Menyimpan…" : "Buat Jadwal"}
        </Button>
      </DialogFooter>
    </>
  );
}
