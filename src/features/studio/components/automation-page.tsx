"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, MoonStar, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import type { JobSettings } from "@/lib/studio/jobs";
import type { ApiMessage } from "../types";
import { Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

interface JobRun {
  id: string;
  job_code: "daily_close" | "reminders";
  run_date: string;
  trigger: "auto" | "manual";
  status: "running" | "success" | "failed";
  summary: Record<string, number>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface NotificationRow {
  id: string;
  kind: "session_reminder" | "waitlist_promoted" | "pass_low" | "pass_expiring";
  status: "pending" | "sent" | "failed" | "skipped";
  error: string | null;
  message: string;
  created_at: string;
  member_name: string | null;
  phone: string | null;
}

interface AutomationData {
  settings: JobSettings;
  wa_provider: string | null;
  runs: JobRun[];
  notifications: NotificationRow[];
  backlog: { sessions: number; passes: number };
}

const KIND_LABEL: Record<NotificationRow["kind"], string> = {
  session_reminder: "H-1 sesi",
  waitlist_promoted: "Naik dari waitlist",
  pass_low: "Kredit hampir habis",
  pass_expiring: "Paket hampir berakhir",
};

const PROVIDER_LABEL: Record<string, string> = { meta: "WhatsApp Cloud API (Meta)", gateway: "WA Gateway", fonnte: "Fonnte" };

const fmtTime = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}.00`;

export function StudioAutomationPage() {
  const [data, setData] = useState<AutomationData | null>(null);
  const [form, setForm] = useState<JobSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<"daily_close" | "reminders" | null>(null);

  const load = useCallback(async () => {
    try {
      const d = (await apiGet<{ data: AutomationData }>("/api/studio/automation")).data;
      setData(d);
      setForm(d.settings);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const res = await apiPatch<ApiMessage>("/api/studio/automation/settings", form);
      toast.success(res.message ?? "Tersimpan");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  async function run(job: "daily_close" | "reminders") {
    if (job === "daily_close" && !confirm("Jalankan tutup hari sekarang? Sesi yang sudah lewat diselesaikan (yang tidak check-in = tidak hadir) dan pass yang lewat masa berlaku ditutup.")) return;
    setRunning(job);
    try {
      const res = await apiPost<ApiMessage>("/api/studio/automation/run", { job });
      toast.success(res.message ?? "Selesai");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menjalankan");
    } finally {
      setRunning(null);
    }
  }

  if (!data || !form) {
    return (
      <div className="flex justify-center py-24 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const lastClose = data.runs.find((r) => r.job_code === "daily_close");
  const set = <K extends keyof JobSettings>(k: K, v: JobSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Otomasi & Pengingat"
        subtitle="Pekerjaan rutin yang dijalankan sistem setiap hari, dan pengingat WhatsApp untuk member."
        actions={
          dirty ? (
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />} Simpan perubahan
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-nh-forest text-nh-lime">
                <MoonStar className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-lg font-semibold text-foreground">Tutup hari otomatis</h2>
                <p className="text-sm text-muted-foreground">Selesaikan sesi yang sudah lewat (yang tidak check-in tercatat tidak hadir), akui revenue, dan tutup pass yang lewat masa berlaku.</p>
              </div>
            </div>
            <Switch checked={form.auto_close_enabled} onCheckedChange={(v) => set("auto_close_enabled", v)} aria-label="Tutup hari otomatis" />
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Jalan setiap hari pukul (WIB)" hint="Server mati di jam itu? Dikejar otomatis saat menyala.">
              <NativeSelect value={form.auto_close_hour} onChange={(e) => set("auto_close_hour", Number(e.target.value))} disabled={!form.auto_close_enabled}>
                {[18, 19, 20, 21, 22, 23].map((h) => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </NativeSelect>
            </Field>
            <div className="rounded-lg bg-secondary/60 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Menunggu diproses</p>
              <p className="mt-1 font-medium text-foreground">
                {data.backlog.sessions} sesi · {data.backlog.passes} pass
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {lastClose ? (
                <>
                  Terakhir {fmtTime(lastClose.started_at)} ({lastClose.trigger === "auto" ? "otomatis" : "manual"}) ·{" "}
                  {lastClose.status === "failed" ? (
                    <span className="text-destructive">gagal: {lastClose.error}</span>
                  ) : (
                    `${lastClose.summary.sessions_completed ?? 0} sesi, ${lastClose.summary.passes_expired ?? 0} pass`
                  )}
                </>
              ) : (
                "Belum pernah berjalan."
              )}
            </p>
            <Button variant="outline" onClick={() => run("daily_close")} disabled={running !== null}>
              {running === "daily_close" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Jalankan sekarang
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-nh-forest text-nh-lime">
                <MessageCircle className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-lg font-semibold text-foreground">Pengingat WhatsApp member</h2>
                <p className="text-sm text-muted-foreground">Dikirim hanya pukul 08.00–21.00 WIB, sekali per kejadian. Member bisa mematikannya dari Member App.</p>
              </div>
            </div>
            <Switch checked={form.reminders_enabled} onCheckedChange={(v) => set("reminders_enabled", v)} aria-label="Pengingat WhatsApp" />
          </div>

          {data.wa_provider ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-foreground">
              <CheckCircle2 className="size-4 text-nh-lettuce" /> Terhubung lewat {PROVIDER_LABEL[data.wa_provider] ?? data.wa_provider}
            </p>
          ) : (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> WhatsApp belum dikonfigurasi — pengingat akan tercatat gagal sampai WA Gateway diatur.
            </p>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Kirim pengingat H-1 pukul">
              <NativeSelect value={form.reminder_hour} onChange={(e) => set("reminder_hour", Number(e.target.value))} disabled={!form.reminders_enabled}>
                {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Kredit hampir habis bila sisa ≤">
              <NativeSelect value={form.pass_low_threshold} onChange={(e) => set("pass_low_threshold", Number(e.target.value))} disabled={!form.reminders_enabled}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>{n} sesi</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Paket berakhir dalam">
              <NativeSelect value={form.pass_expiring_days} onChange={(e) => set("pass_expiring_days", Number(e.target.value))} disabled={!form.reminders_enabled}>
                {[1, 2, 3, 5, 7].map((n) => (
                  <option key={n} value={n}>{n} hari</option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
            <li>• <span className="text-foreground">H-1 sesi</span> — kelas & Personal Training besok, plus batas batal.</li>
            <li>• <span className="text-foreground">Naik dari waitlist</span> — langsung saat ada tempat kosong.</li>
            <li>• <span className="text-foreground">Kredit hampir habis</span> & <span className="text-foreground">paket hampir berakhir</span> — ajakan lanjut latihan.</li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Isi pesan dikirim dalam bahasa Inggris, seragam dengan Member App.</p>

          <div className="mt-4 flex justify-end border-t border-border pt-4">
            <Button variant="outline" onClick={() => run("reminders")} disabled={running !== null || !data.settings.reminders_enabled}>
              {running === "reminders" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Kirim pengingat sekarang
            </Button>
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <section>
          <h2 className="mb-3 font-display text-base font-semibold text-foreground">Riwayat job</h2>
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5">Waktu</th>
                  <th className="px-4 py-2.5">Job</th>
                  <th className="px-4 py-2.5">Hasil</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">Belum ada riwayat.</td>
                  </tr>
                )}
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{fmtTime(r.started_at)}</td>
                    <td className="px-4 py-2.5">
                      {r.job_code === "daily_close" ? "Tutup hari" : "Pengingat WA"} <span className="text-xs text-muted-foreground">· {r.trigger === "auto" ? "otomatis" : "manual"}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.status === "failed" ? (
                        <span className="text-destructive">Gagal: {r.error}</span>
                      ) : r.status === "running" ? (
                        <Pill>Berjalan</Pill>
                      ) : r.job_code === "daily_close" ? (
                        `${r.summary.sessions_completed ?? 0} sesi · ${r.summary.passes_expired ?? 0} pass · ${r.summary.orders_expired ?? 0} pesanan`
                      ) : (
                        `${r.summary.sent ?? 0} terkirim · ${r.summary.failed ?? 0} gagal`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 font-display text-base font-semibold text-foreground">Log pengingat</h2>
          <div className="space-y-2">
            {data.notifications.length === 0 && <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Belum ada pengingat terkirim.</p>}
            {data.notifications.map((n) => (
              <details key={n.id} className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{n.member_name ?? n.phone}</span>
                    <span className="text-muted-foreground"> · {KIND_LABEL[n.kind]} · {fmtTime(n.created_at)}</span>
                  </span>
                  <Pill tone={n.status === "sent" ? "positive" : n.status === "failed" ? "danger" : "neutral"}>
                    {n.status === "sent" ? "Terkirim" : n.status === "failed" ? "Gagal" : n.status === "skipped" ? "Dilewati" : "Antre"}
                  </Pill>
                </summary>
                <p className="mt-2 whitespace-pre-line rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">{n.message}</p>
                {n.error && <p className="mt-1 text-xs text-destructive">{n.error}</p>}
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
