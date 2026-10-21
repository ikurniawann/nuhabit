"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarOff, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { MAX_BLACKOUT_DAYS } from "@/lib/studio/coach-leave";
import { LEAVE_TYPE_LABELS, type LeaveType } from "@/types/hris";
import { formatDayLabel } from "../types";
import { EmptyState, Field } from "./ui-bits";

/**
 * Tanggal blackout cuti coach (EPIC-067 T-067-A2). Program Director menetapkan
 * rentang tanggal + alasan; pengajuan jenis cuti yang "kena blackout" di rentang
 * itu ditolak kecuali coach meminta pengecualian. Cuti yang sudah ada tidak
 * dibatalkan otomatis — ditampilkan untuk ditinjau.
 */

interface BlackoutRow {
  id: string;
  date_from: string;
  date_to: string;
  reason: string;
  created_by_name: string | null;
}

interface OverlapLeave {
  leave_id: string;
  coach_name: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  status: "pending" | "approved";
}

const EMPTY = { date_from: "", date_to: "", reason: "" };
const rangeLabel = (a: string, b: string) => (a === b ? formatDayLabel(a) : `${formatDayLabel(a)} – ${formatDayLabel(b)}`);

export function CoachLeaveBlackouts({ blackoutTypes }: { blackoutTypes: LeaveType[] }) {
  const [rows, setRows] = useState<BlackoutRow[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [overlap, setOverlap] = useState<OverlapLeave[] | null>(null);

  const load = useCallback(
    () =>
      apiGet<{ data: BlackoutRow[] }>("/api/studio/coach-leave/blackouts")
        .then((r) => setRows(r.data))
        .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat tanggal blackout")),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const valid = Boolean(form.date_from && form.date_to && form.date_to >= form.date_from && form.reason.trim().length >= 3);

  async function add() {
    setSaving(true);
    try {
      const r = await apiPost<{ data: { overlapping: OverlapLeave[] }; message?: string }>("/api/studio/coach-leave/blackouts", {
        ...form,
        reason: form.reason.trim(),
      });
      toast.success(r.message ?? "Tersimpan");
      setOverlap(r.data.overlapping.length > 0 ? r.data.overlapping : null);
      setForm(EMPTY);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await apiDelete(`/api/studio/coach-leave/blackouts/${id}`);
      toast.success("Tanggal blackout dihapus");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus");
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <CalendarOff className="mt-0.5 size-5 shrink-0 text-nh-forest" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground">Tanggal blackout cuti</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Tanggal yang tidak boleh diambil cuti (mis. hari event). Berlaku untuk{" "}
            {blackoutTypes.length > 0 ? blackoutTypes.map((t) => LEAVE_TYPE_LABELS[t]).join(", ") : "— (belum ada jenis cuti yang kena blackout)"}
            ; atur di tabel minimal pemberitahuan. Coach tetap bisa meminta pengecualian — Program Director wajib menulis alasan saat
            menyetujuinya.
          </p>
        </div>
      </div>

      <div className="mt-4">
        {!rows ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <EmptyState title="Belum ada tanggal blackout mendatang" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{rangeLabel(b.date_from, b.date_to)}</p>
                  <p className="text-sm text-muted-foreground">
                    {b.reason}
                    {b.created_by_name ? ` · oleh ${b.created_by_name}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Hapus blackout ${b.reason}`} onClick={() => remove(b.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
        <Field label="Mulai">
          <Input
            type="date"
            value={form.date_from}
            onChange={(e) => setForm((f) => ({ ...f, date_from: e.target.value, date_to: !f.date_to || f.date_to < e.target.value ? e.target.value : f.date_to }))}
          />
        </Field>
        <Field label="Sampai">
          <Input type="date" value={form.date_to} min={form.date_from || undefined} onChange={(e) => setForm((f) => ({ ...f, date_to: e.target.value }))} />
        </Field>
        <Field label="Alasan">
          <Input placeholder="Contoh: Hyrox Jakarta Open" maxLength={200} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
        </Field>
        <Button onClick={add} disabled={!valid || saving}>
          {saving && <Loader2 className="size-4 animate-spin" />} Tambah
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">Satu rentang maksimal {MAX_BLACKOUT_DAYS} hari.</p>

      {overlap && (
        <div className="mt-4 rounded-lg border border-nh-ochre/60 bg-nh-ochre/5 p-3 text-sm">
          <p className="font-semibold text-foreground">Cuti coach yang sudah ada di rentang ini</p>
          <p className="text-muted-foreground">
            Tidak dibatalkan otomatis. Yang masih menunggu hanya bisa disetujui sebagai pengecualian; yang sudah disetujui tinjau langsung
            dengan coach-nya.
          </p>
          <ul className="mt-2 space-y-1">
            {overlap.map((o) => (
              <li key={o.leave_id} className="text-foreground">
                {o.coach_name} · {LEAVE_TYPE_LABELS[o.leave_type] ?? o.leave_type} · {rangeLabel(o.start_date, o.end_date)} ·{" "}
                {o.status === "approved" ? "Disetujui" : "Menunggu"}
              </li>
            ))}
          </ul>
          <button type="button" className="mt-2 text-xs font-semibold underline underline-offset-4" onClick={() => setOverlap(null)}>
            Tutup
          </button>
        </div>
      )}
    </section>
  );
}
