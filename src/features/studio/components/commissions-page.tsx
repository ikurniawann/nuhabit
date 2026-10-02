"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck, ChevronLeft, ChevronRight, Loader2, Settings2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { COMMISSION_STATUS_LABEL, periodLabel, shiftPeriod, type CommissionSettings } from "@/lib/studio/commission";
import { COACH_LEVEL_LABEL } from "@/lib/studio/schedule";
import type { ApiMessage } from "../types";
import { rupiah, todayIso } from "../types";
import { Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

interface PeriodLine {
  id: string | null;
  coach_id: string;
  coach_name: string;
  level: "coach" | "head_coach";
  share_percent: number;
  amount: number;
  class_sessions: number;
  pt_sessions: number;
  attendees: number;
  status: "pending" | "paid";
  paid_at: string | null;
  payment_method: string | null;
  payment_ref: string | null;
}

interface PeriodView {
  period: string;
  status: "preview" | "draft" | "approved" | "paid";
  settings: CommissionSettings;
  class_revenue: number;
  pt_revenue: number;
  class_pool: number;
  pt_pool: number;
  total_pool: number;
  allocated_percent: number;
  allocated_amount: number;
  retained_amount: number;
  over_allocated: boolean;
  month_closed: boolean;
  approved_at: string | null;
  accrual_journal_id: string | null;
  lines: PeriodLine[];
}

export function StudioCommissionsPage() {
  const thisMonth = todayIso().slice(0, 7);
  const [period, setPeriod] = useState(() => shiftPeriod(thisMonth, -1));
  const [view, setView] = useState<PeriodView | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [paying, setPaying] = useState<PeriodLine | null>(null);
  const [editShare, setEditShare] = useState<PeriodLine | null>(null);

  const load = useCallback(async () => {
    setView(null);
    try {
      setView((await apiGet<{ data: PeriodView }>(`/api/studio/commissions/${period}`)).data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat komisi");
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const locked = view && (view.status === "approved" || view.status === "paid");

  async function approve() {
    if (!view) return;
    if (!confirm(`Setujui komisi ${periodLabel(period)}?\n\nTotal Rp ${Math.round(view.allocated_amount).toLocaleString("id-ID")} untuk ${view.lines.length} coach. Angka dikunci dan jurnal akrual dicatat.`)) return;
    setBusy(true);
    try {
      const res = await apiPost<{ data: PeriodView; message?: string }>(`/api/studio/commissions/${period}/approve`, {});
      toast.success(res.message ?? "Disetujui");
      setView(res.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyetujui");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Komisi Coach"
        subtitle="Insentif di luar payroll: pool dari revenue kelas & Personal Training yang diakui, dibagi per coach sesuai persentase peran."
        actions={
          <Button variant="outline" onClick={() => setShowSettings(true)}>
            <Settings2 className="size-4" /> Skema komisi
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Bulan sebelumnya" onClick={() => setPeriod(shiftPeriod(period, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" onClick={() => setPeriod(thisMonth)}>Bulan ini</Button>
        <Button variant="outline" size="icon" aria-label="Bulan berikutnya" onClick={() => setPeriod(shiftPeriod(period, 1))}>
          <ChevronRight className="size-4" />
        </Button>
        <span className="ml-1 font-display text-lg font-semibold text-foreground">{periodLabel(period)}</span>
        {view && (
          <Pill tone={view.status === "paid" ? "brand" : view.status === "approved" ? "positive" : "neutral"}>
            {view.status === "preview" || view.status === "draft" ? (view.month_closed ? "Siap disetujui" : "Berjalan (estimasi)") : COMMISSION_STATUS_LABEL[view.status]}
          </Pill>
        )}
      </div>

      {!view ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <>
          <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Stat label="Revenue kelas diakui" value={rupiah(view.class_revenue)} sub={`Pool ${view.settings.class_pool_percent}% = ${rupiah(view.class_pool)}`} />
            <Stat label="Revenue Personal Training diakui" value={rupiah(view.pt_revenue)} sub={`Pool ${view.settings.pt_pool_percent}% = ${rupiah(view.pt_pool)}`} />
            <Stat label="Total pool komisi" value={rupiah(view.total_pool)} sub={`Dialokasikan ${view.allocated_percent}% · ${rupiah(view.allocated_amount)}`} highlight />
            <Stat label="Sisa ke revenue perusahaan" value={rupiah(view.retained_amount)} sub={view.allocated_percent < 100 ? `${(100 - view.allocated_percent).toFixed(0)}% pool tidak dialokasikan` : "Pool habis dibagi"} />
          </div>

          {view.over_allocated && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Total persentase {view.allocated_percent}% melebihi 100%. Turunkan persentase coach atau ubah skema sebelum menyetujui.
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Coach</th>
                  <th className="px-4 py-3 text-right">Kelas</th>
                  <th className="px-4 py-3 text-right">Personal Training</th>
                  <th className="px-4 py-3 text-right">Peserta hadir</th>
                  <th className="px-4 py-3 text-right">Persentase</th>
                  <th className="px-4 py-3 text-right">Komisi</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Belum ada coach aktif.</td>
                  </tr>
                )}
                {view.lines.map((l) => (
                  <tr key={l.coach_id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{l.coach_name}</div>
                      <div className="text-xs text-muted-foreground">{COACH_LEVEL_LABEL[l.level]}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{l.class_sessions}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{l.pt_sessions}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{l.attendees}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {locked ? (
                        `${l.share_percent}%`
                      ) : (
                        <button type="button" onClick={() => setEditShare(l)} className="rounded px-1 underline decoration-dotted underline-offset-4 transition hover:text-nh-forest">
                          {l.share_percent}%
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{rupiah(l.amount)}</td>
                    <td className="px-4 py-3">
                      {!locked ? (
                        <Pill>Estimasi</Pill>
                      ) : l.status === "paid" ? (
                        <Pill tone="brand">Dibayar{l.payment_method ? ` · ${l.payment_method === "cash" ? "tunai" : "transfer"}` : ""}</Pill>
                      ) : (
                        <Button size="sm" onClick={() => setPaying(l)}>
                          <Wallet className="size-3.5" /> Bayar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Revenue = nilai kredit kelas & Personal Training yang diakui saat dipakai (hadir, tidak hadir, batal telat). Nilai pass kedaluwarsa tidak masuk pool.
              {view.accrual_journal_id ? " Jurnal akrual sudah diposting." : locked ? " Jurnal belum diposting (atur mapping COA modul STUDIO)." : ""}
            </p>
            {!locked && (
              <Button onClick={approve} disabled={busy || !view.month_closed || view.over_allocated}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
                {view.month_closed ? "Setujui komisi" : "Bisa disetujui setelah bulan berakhir"}
              </Button>
            )}
          </div>
        </>
      )}

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} onSaved={() => { setShowSettings(false); void load(); }} />}
      {paying && <PayDialog line={paying} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); void load(); }} />}
      {editShare && <ShareDialog line={editShare} onClose={() => setEditShare(null)} onSaved={() => { setEditShare(null); void load(); }} />}
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${highlight ? "border-nh-forest bg-nh-forest text-nh-beige" : "border-border bg-card"}`}>
      <p className={`text-xs ${highlight ? "text-nh-beige/70" : "text-muted-foreground"}`}>{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${highlight ? "text-nh-lime" : "text-foreground"}`}>{value}</p>
      <p className={`mt-1 text-xs ${highlight ? "text-nh-beige/70" : "text-muted-foreground"}`}>{sub}</p>
    </div>
  );
}

function SettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<CommissionSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiGet<{ data: CommissionSettings }>("/api/studio/commissions/settings").then((r) => setForm(r.data)).catch(() => onClose());
  }, [onClose]);
  if (!form) return null;
  const set = (k: keyof CommissionSettings, v: string) => setForm((f) => (f ? { ...f, [k]: Math.max(0, Math.min(100, Number(v) || 0)) } : f));
  async function save() {
    setBusy(true);
    try {
      const res = await apiPatch<ApiMessage>("/api/studio/commissions/settings", form);
      toast.success(res.message ?? "Tersimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Skema komisi</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pool dari revenue kelas (%)">
            <Input type="number" min={0} max={100} value={form.class_pool_percent} onChange={(e) => set("class_pool_percent", e.target.value)} />
          </Field>
          <Field label="Pool dari revenue Personal Training (%)">
            <Input type="number" min={0} max={100} value={form.pt_pool_percent} onChange={(e) => set("pt_pool_percent", e.target.value)} />
          </Field>
          <Field label="Bagian Head Coach (% per orang)">
            <Input type="number" min={0} max={100} value={form.share_head_coach} onChange={(e) => set("share_head_coach", e.target.value)} />
          </Field>
          <Field label="Bagian Coach (% per orang)">
            <Input type="number" min={0} max={100} value={form.share_coach} onChange={(e) => set("share_coach", e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">Berlaku untuk bulan yang belum disetujui. Persentase per orang tetap; sisa pool di bawah 100% menjadi revenue perusahaan.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Simpan</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ line, onClose, onSaved }: { line: PeriodLine; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(String(line.share_percent));
  const [busy, setBusy] = useState(false);
  async function save(reset: boolean) {
    setBusy(true);
    try {
      const res = await apiPut<ApiMessage>(`/api/studio/coaches/${line.coach_id}/share`, { commission_share_percent: reset ? null : Number(value) });
      toast.success(res.message ?? "Tersimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Persentase {line.coach_name}</DialogTitle>
        </DialogHeader>
        <Field label="Persentase pool (%)" hint="Berlaku seterusnya sampai dikembalikan ke peran.">
          <Input type="number" min={0} max={100} step="0.5" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => save(true)} disabled={busy}>Ikut peran</Button>
          <Button onClick={() => save(false)} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Simpan</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ line, onClose, onPaid }: { line: PeriodLine; onClose: () => void; onPaid: () => void }) {
  const [method, setMethod] = useState<"transfer" | "cash">("transfer");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  async function pay() {
    if (!line.id) return;
    setBusy(true);
    try {
      const res = await apiPost<ApiMessage>(`/api/studio/commissions/lines/${line.id}/pay`, { method, ref: ref.trim() || null });
      toast.success(res.message ?? "Dibayar");
      onPaid();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencatat pembayaran");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Bayar komisi {line.coach_name}</DialogTitle>
        </DialogHeader>
        <p className="font-display text-3xl font-semibold tabular-nums text-foreground">{rupiah(line.amount)}</p>
        <Field label="Metode">
          <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as "transfer" | "cash")}>
            <option value="transfer">Transfer bank</option>
            <option value="cash">Tunai</option>
          </NativeSelect>
        </Field>
        <Field label="No. referensi">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Mis. nomor transfer" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={pay} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Catat pembayaran</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
