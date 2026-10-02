"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiGet, apiPatch } from "@/lib/api-client";
import type { StudioSettings } from "@/lib/studio/booking";
import { Field, StudioPageHeader } from "./ui-bits";

export function StudioSettingsPage() {
  const [form, setForm] = useState<StudioSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ data: StudioSettings }>("/api/studio/settings")
      .then((res) => setForm(res.data))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat aturan"));
  }, []);

  if (!form) {
    return (
      <div className="flex justify-center p-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const set = <K extends keyof StudioSettings>(key: K, value: StudioSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

  async function save() {
    setBusy(true);
    try {
      const res = await apiPatch<{ data: StudioSettings; message?: string }>("/api/studio/settings", form);
      setForm(res.data);
      toast.success(res.message ?? "Tersimpan");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader title="Aturan Booking" subtitle="Berlaku untuk booking dari front desk maupun Member App. Perubahan langsung berlaku untuk booking berikutnya." />
      <div className="grid max-w-3xl gap-4">
        <section className="grid gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:grid-cols-2">
          <Field label="Batas cancel (jam sebelum kelas)" hint="Cancel sebelum batas ini → kredit kembali. Lewat batas → kredit hangus.">
            <Input type="number" min={0} max={72} value={form.cancel_window_hours} onChange={(e) => set("cancel_window_hours", num(e.target.value))} />
          </Field>
          <Field label="Booking dibuka (hari ke depan)" hint="Member hanya bisa booking kelas dalam rentang ini.">
            <Input type="number" min={1} max={60} value={form.booking_open_days} onChange={(e) => set("booking_open_days", num(e.target.value))} />
          </Field>
          <Field label="Booking ditutup (menit sebelum kelas)" hint="0 = bisa booking sampai kelas mulai. Staf tetap bisa walk-in.">
            <Input type="number" min={0} max={240} value={form.booking_close_minutes} onChange={(e) => set("booking_close_minutes", num(e.target.value))} />
          </Field>
          <Field label="Check-in dibuka (menit sebelum kelas)">
            <Input type="number" min={0} max={240} value={form.checkin_open_minutes} onChange={(e) => set("checkin_open_minutes", num(e.target.value))} />
          </Field>
          <Field label="Maks booking aktif per member" hint="0 = tanpa batas. Tidak berlaku untuk booking oleh staf.">
            <Input type="number" min={0} max={50} value={form.max_active_bookings} onChange={(e) => set("max_active_bookings", num(e.target.value))} />
          </Field>
          <div className="flex items-center justify-between self-end rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">Waitlist saat kelas penuh</span>
            <Switch checked={form.waitlist_enabled} onCheckedChange={(v) => set("waitlist_enabled", v)} aria-label="Waitlist saat kelas penuh" />
          </div>
        </section>
        <section className="rounded-xl border border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">Cara kredit & revenue bekerja</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Kredit kelas dikunci saat booking, jadi kursi pasti milik member.</li>
            <li>Tidak hadir (no-show) dan batal lewat batas → kredit hangus.</li>
            <li>Revenue kelas & dasar komisi coach diakui saat kelas diselesaikan di Check-in & Booking.</li>
            <li>Waitlist tidak mengunci kredit; kredit dikunci saat member naik karena ada kursi kosong.</li>
          </ul>
        </section>
        <div>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Simpan aturan
          </Button>
        </div>
      </div>
    </div>
  );
}
