"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { type DisciplineRules, INCIDENT_KIND_LABEL, INCIDENT_KINDS, type IncidentKind, warningLabel } from "@/lib/studio/coach-discipline";
import { formatDayLabel, todayIso } from "../types";
import { EmptyState, Field, NativeSelect, Pill } from "./ui-bits";

/**
 * Disiplin coach (EPIC-067 T-067-A8): usulan SP untuk Program Director,
 * catat tidak hadir / terlambat (cuti mendadak tercatat otomatis), batalkan
 * catatan beralasan, dan aturan potongan komisi & ambang SP.
 */

interface Incident {
  id: string;
  coach_name: string;
  kind: IncidentKind;
  occurred_on: string;
  minutes_late: number | null;
  note: string | null;
  deduction_percent: number;
  status: "active" | "void";
  void_reason: string | null;
}

interface Warning {
  id: string;
  coach_name: string;
  level: number;
  status: "proposed" | "issued" | "dismissed";
  incident_count: number;
  incident_summary: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

interface DisciplineData {
  rules: DisciplineRules;
  incidents: Incident[];
  warnings: Warning[];
}

const KIND_TONE: Record<IncidentKind, "danger" | "warning"> = { no_show: "danger", short_notice_leave: "warning", late: "warning" };

export function CoachDisciplineSection() {
  const [data, setData] = useState<DisciplineData | null>(null);
  const [coaches, setCoaches] = useState<{ id: string; full_name: string; display_name: string | null }[]>([]);

  const load = useCallback(
    () =>
      apiGet<{ data: DisciplineData }>("/api/studio/coach-leave/discipline")
        .then((r) => setData(r.data))
        .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat disiplin coach")),
    []
  );

  useEffect(() => {
    load();
    apiGet<{ data: { id: string; full_name: string; display_name: string | null }[] }>("/api/studio/coaches?active=1")
      .then((r) => setCoaches(r.data))
      .catch(() => setCoaches([]));
  }, [load]);

  if (!data) return <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />;
  const proposed = data.warnings.filter((w) => w.status === "proposed");
  const decided = data.warnings.filter((w) => w.status !== "proposed");

  return (
    <section className="grid gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div>
        <p className="text-[13px] font-semibold text-foreground">Disiplin coach</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pelanggaran memotong komisi bulan kejadian (maks {data.rules.max_deduction_percent}%) dan, setelah {data.rules.warning_threshold} kejadian dalam{" "}
          {data.rules.warning_window_days} hari, memunculkan usulan SP berikutnya. SP berlaku 6 bulan. Cuti mendadak tercatat otomatis saat disetujui.
        </p>
      </div>

      {proposed.length > 0 && (
        <div className="grid gap-2">
          {proposed.map((w) => (
            <WarningCard key={w.id} warning={w} onDone={load} />
          ))}
        </div>
      )}

      <RecordIncident coaches={coaches} onSaved={load} />

      <div>
        <p className="mb-2 text-[13px] font-semibold text-foreground">Catatan 120 hari terakhir</p>
        {data.incidents.length === 0 ? (
          <EmptyState title="Belum ada pelanggaran tercatat" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.incidents.map((i) => (
              <IncidentLine key={i.id} incident={i} onChanged={load} />
            ))}
          </ul>
        )}
      </div>

      {decided.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-foreground">Riwayat SP</p>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {decided.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="text-foreground">
                  {w.coach_name} · {warningLabel(w.level)} · {w.incident_count} pelanggaran
                </span>
                <span className="text-xs text-muted-foreground">
                  {w.status === "issued" ? "Diterbitkan" : `Diabaikan${w.decision_note ? `: ${w.decision_note}` : ""}`}
                  {w.decided_by_name ? ` · ${w.decided_by_name}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <RulesForm rules={data.rules} onSaved={load} />
    </section>
  );
}

function WarningCard({ warning: w, onDone }: { warning: Warning; onDone: () => Promise<unknown> }) {
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "issued" | "dismissed") {
    setBusy(true);
    try {
      const res = await apiPost<{ message?: string }>(`/api/studio/coach-leave/discipline/warnings/${w.id}`, { decision, note: note.trim() || null });
      toast.success(res.message ?? "Tersimpan");
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="font-semibold text-foreground">
        Usulan {warningLabel(w.level)} · {w.coach_name}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {w.incident_count} pelanggaran: {w.incident_summary ?? "-"}
      </p>
      {dismissing ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Input className="max-w-sm" placeholder="Alasan mengabaikan" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Alasan mengabaikan SP" />
          <Button size="sm" variant="outline" disabled={busy || note.trim().length < 3} onClick={() => decide("dismissed")}>
            Abaikan usulan
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissing(false)}>
            Batal
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => decide("issued")}>
            {busy && <Loader2 className="size-3.5 animate-spin" />} Terbitkan {warningLabel(w.level)}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDismissing(true)}>
            Abaikan
          </Button>
        </div>
      )}
    </div>
  );
}

function RecordIncident({ coaches, onSaved }: { coaches: { id: string; full_name: string; display_name: string | null }[]; onSaved: () => Promise<unknown> }) {
  const [form, setForm] = useState({ coach_id: "", kind: "no_show" as "no_show" | "late", occurred_on: todayIso(), minutes_late: "", note: "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiPost("/api/studio/coach-leave/discipline/incidents", {
        coach_id: form.coach_id,
        kind: form.kind,
        occurred_on: form.occurred_on,
        minutes_late: form.kind === "late" ? Number(form.minutes_late) || null : null,
        note: form.note.trim() || null,
      });
      toast.success("Pelanggaran dicatat");
      setForm((f) => ({ ...f, minutes_late: "", note: "" }));
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencatat");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-4">
      <Field label="Coach">
        <NativeSelect value={form.coach_id} onChange={(e) => setForm((f) => ({ ...f, coach_id: e.target.value }))}>
          <option value="">— Pilih coach —</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name || c.full_name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Jenis">
        <NativeSelect value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as "no_show" | "late" }))}>
          <option value="no_show">{INCIDENT_KIND_LABEL.no_show}</option>
          <option value="late">{INCIDENT_KIND_LABEL.late}</option>
        </NativeSelect>
      </Field>
      <Field label="Tanggal">
        <Input type="date" value={form.occurred_on} onChange={(e) => setForm((f) => ({ ...f, occurred_on: e.target.value }))} />
      </Field>
      {form.kind === "late" ? (
        <Field label="Terlambat (menit)">
          <Input type="number" min={1} max={600} value={form.minutes_late} onChange={(e) => setForm((f) => ({ ...f, minutes_late: e.target.value }))} />
        </Field>
      ) : (
        <div />
      )}
      <Field label="Catatan" className="sm:col-span-3">
        <Input maxLength={500} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Mis. tidak datang ke kelas 07.00 tanpa kabar" />
      </Field>
      <div className="self-end">
        <Button onClick={save} disabled={busy || !form.coach_id || (form.kind === "late" && !Number(form.minutes_late))}>
          {busy && <Loader2 className="size-4 animate-spin" />} Catat
        </Button>
      </div>
    </div>
  );
}

function IncidentLine({ incident: i, onChanged }: { incident: Incident; onChanged: () => Promise<unknown> }) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function voidIt() {
    setBusy(true);
    try {
      await apiPost(`/api/studio/coach-leave/discipline/incidents/${i.id}/void`, { reason: reason.trim() });
      toast.success("Catatan dibatalkan");
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membatalkan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`p-3 text-sm ${i.status === "void" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {formatDayLabel(i.occurred_on)} · {i.coach_name}
          </p>
          <p className="text-xs text-muted-foreground">
            {[i.minutes_late ? `${i.minutes_late} menit` : null, i.note, i.status === "void" ? `Dibatalkan: ${i.void_reason}` : `potongan ${i.deduction_percent}%`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={i.status === "void" ? "neutral" : KIND_TONE[i.kind]}>{INCIDENT_KIND_LABEL[i.kind]}</Pill>
          {i.status === "active" && !voiding && (
            <button type="button" className="text-xs font-semibold text-muted-foreground underline underline-offset-4" onClick={() => setVoiding(true)}>
              Batalkan
            </button>
          )}
        </div>
      </div>
      {voiding && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Input className="max-w-sm" placeholder="Alasan (mis. ada surat dokter)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Alasan membatalkan" />
          <Button size="sm" variant="outline" disabled={busy || reason.trim().length < 5} onClick={voidIt}>
            Simpan
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setVoiding(false)}>
            Batal
          </Button>
        </div>
      )}
    </li>
  );
}

function RulesForm({ rules, onSaved }: { rules: DisciplineRules; onSaved: () => Promise<unknown> }) {
  const [form, setForm] = useState(rules);
  const [busy, setBusy] = useState(false);
  const int = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(v) || 0)));
  const dirty = JSON.stringify(form) !== JSON.stringify(rules);

  async function save() {
    setBusy(true);
    try {
      await apiPatch("/api/studio/coach-leave/discipline/rules", form);
      toast.success("Aturan disiplin disimpan");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-foreground">Aturan potongan & SP</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {INCIDENT_KINDS.map((k) => (
          <Field key={k} label={`Potongan: ${INCIDENT_KIND_LABEL[k]} (%)`}>
            <Input
              type="number"
              min={0}
              max={100}
              value={form.deduction_percent[k]}
              onChange={(e) => setForm((f) => ({ ...f, deduction_percent: { ...f.deduction_percent, [k]: int(e.target.value, 0, 100) } }))}
            />
          </Field>
        ))}
        <Field label="Maks potongan per bulan (%)">
          <Input type="number" min={0} max={100} value={form.max_deduction_percent} onChange={(e) => setForm((f) => ({ ...f, max_deduction_percent: int(e.target.value, 0, 100) }))} />
        </Field>
        <Field label="Usulan SP setelah (kejadian)">
          <Input type="number" min={1} max={20} value={form.warning_threshold} onChange={(e) => setForm((f) => ({ ...f, warning_threshold: int(e.target.value, 1, 20) }))} />
        </Field>
        <Field label="Dalam jendela (hari)">
          <Input type="number" min={7} max={365} value={form.warning_window_days} onChange={(e) => setForm((f) => ({ ...f, warning_window_days: int(e.target.value, 7, 365) }))} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Berlaku untuk catatan baru; catatan lama tetap memakai potongan saat dicatat.</p>
      <Button className="mt-3" size="sm" onClick={save} disabled={busy || !dirty}>
        {busy && <Loader2 className="size-3.5 animate-spin" />} Simpan aturan
      </Button>
    </details>
  );
}
