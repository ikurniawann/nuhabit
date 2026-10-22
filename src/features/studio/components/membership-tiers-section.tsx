"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Gem, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import type { ApiMessage } from "../types";
import { rupiah } from "../types";
import { Pill } from "./ui-bits";

/**
 * Membership (EPIC-069) di Program Loyalitas: tangga tier dari spending 12
 * bulan berjalan. Ambang & perks diisi client; tidak ada tier bawaan.
 */

export interface MembershipTierRow {
  id: string;
  name: string;
  min_spend: number;
  display_color: string | null;
  discount_percent: number;
  early_booking_days: number;
  cancel_window_hours: number | null;
  waitlist_priority: boolean;
  perks: string[];
  members: number;
}

interface MembershipData {
  tiers: MembershipTierRow[];
  members_with_spend: number;
  recent_changes: {
    id: string;
    direction: "up" | "down";
    from_tier_name: string | null;
    to_tier_name: string | null;
    spend_12m: number;
    created_at: string;
    customer_name: string | null;
    phone: string | null;
  }[];
}

interface FormState {
  name: string;
  min_spend: string;
  display_color: string;
  discount_percent: string;
  early_booking_days: string;
  cancel_window_hours: string;
  waitlist_priority: boolean;
  perks: string[];
}

const EMPTY: FormState = {
  name: "",
  min_spend: "",
  display_color: "#DAFF59",
  discount_percent: "0",
  early_booking_days: "0",
  cancel_window_hours: "",
  waitlist_priority: false,
  perks: [""],
};

const tanggal = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

/** Ringkasan perks terstruktur satu tier (untuk kartu & Member App). */
export function structuredPerks(t: Pick<MembershipTierRow, "discount_percent" | "early_booking_days" | "cancel_window_hours" | "waitlist_priority">): string[] {
  const out: string[] = [];
  if (t.discount_percent > 0) out.push(`Diskon F&B ${t.discount_percent}%`);
  if (t.early_booking_days > 0) out.push(`Booking dibuka ${t.early_booking_days} hari lebih awal`);
  if (t.cancel_window_hours !== null) out.push(`Batas batal ${t.cancel_window_hours} jam`);
  if (t.waitlist_priority) out.push("Prioritas waitlist");
  return out;
}

export function MembershipTiersSection() {
  const [data, setData] = useState<MembershipData | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      apiGet<{ data: MembershipData }>("/api/studio/loyalty/membership")
        .then((r) => setData(r.data))
        .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat Membership")),
    []
  );

  useEffect(() => {
    let cancelled = false;
    apiGet<{ data: MembershipData }>("/api/studio/loyalty/membership")
      .then((r) => !cancelled && setData(r.data))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Gagal memuat Membership"));
    return () => {
      cancelled = true;
    };
  }, []);

  function openEdit(t: MembershipTierRow) {
    setEditing({
      id: t.id,
      form: {
        name: t.name,
        min_spend: String(t.min_spend),
        display_color: t.display_color ?? "#DAFF59",
        discount_percent: String(t.discount_percent),
        early_booking_days: String(t.early_booking_days),
        cancel_window_hours: t.cancel_window_hours === null ? "" : String(t.cancel_window_hours),
        waitlist_priority: t.waitlist_priority,
        perks: t.perks.length ? t.perks : [""],
      },
    });
  }

  async function save() {
    if (!editing) return;
    const f = editing.form;
    const body = {
      name: f.name.trim(),
      min_spend: Number(f.min_spend),
      display_color: /^#[0-9a-fA-F]{6}$/.test(f.display_color) ? f.display_color : null,
      discount_percent: Number(f.discount_percent) || 0,
      early_booking_days: Number(f.early_booking_days) || 0,
      cancel_window_hours: f.cancel_window_hours === "" ? null : Number(f.cancel_window_hours),
      waitlist_priority: f.waitlist_priority,
      perks: f.perks.map((p) => p.trim()).filter(Boolean),
    };
    setBusy(true);
    try {
      const res = editing.id
        ? await apiPatch<ApiMessage>(`/api/studio/loyalty/membership/${editing.id}`, body)
        : await apiPost<ApiMessage>("/api/studio/loyalty/membership", body);
      toast.success(res.message ?? "Tersimpan");
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: MembershipTierRow) {
    if (!confirm(`Hapus tier ${t.name}? ${t.members} member di tier ini akan dievaluasi ulang dari spending-nya.`)) return;
    try {
      const res = (await apiDelete(`/api/studio/loyalty/membership/${t.id}`)) as ApiMessage;
      toast.success(res.message ?? "Tier dihapus");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus");
    }
  }

  const f = editing?.form;
  const setF = (patch: Partial<FormState>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  const valid = !!f && f.name.trim().length >= 2 && f.min_spend !== "" && Number(f.min_spend) >= 0;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-semibold text-foreground">
            <Gem className="size-4" /> Membership
          </h2>
          <p className="text-sm text-muted-foreground">
            Tier loyalitas dari spending 12 bulan terakhir (paket kelas, Personal Training, dan POS). Naik langsung saat ambang
            tercapai; tier berlaku 12 bulan sejak terakhir memenuhi ambangnya, lalu turun bila spending di bawah ambang. Semua
            benefit booking & diskon F&B berasal dari tier ini.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setEditing({ id: null, form: EMPTY })}>
          <Plus className="size-4" /> Tambah tier
        </Button>
      </div>

      {!data ? (
        <div className="flex justify-center rounded-xl border border-border bg-card py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : data.tiers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-10 text-center">
          <p className="font-medium text-foreground">Belum ada tier Membership.</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
            Tambahkan tier dengan ambang spending dan perks-nya. Selama belum ada tier, member tidak mendapat benefit tier dan
            Member App menampilkan bahwa program Membership segera hadir.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {data.tiers.map((t) => {
            const perks = [...structuredPerks(t), ...t.perks];
            return (
              <div key={t.id} className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
                      <span className="size-3 shrink-0 rounded-full" style={{ background: t.display_color ?? undefined }} />
                      <span className="truncate">{t.name}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{t.min_spend > 0 ? `Mulai ${rupiah(t.min_spend)} / 12 bulan` : "Tier dasar (Rp0)"}</p>
                  </div>
                  <Pill className="shrink-0 whitespace-nowrap">{t.members} member</Pill>
                </div>
                <ul className="mt-3 flex-1 space-y-1 text-sm text-foreground">
                  {perks.length === 0 ? (
                    <li className="text-muted-foreground">Belum ada perks.</li>
                  ) : (
                    perks.map((p) => (
                      <li key={p} className="flex gap-2">
                        <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/50" /> {p}
                      </li>
                    ))
                  )}
                </ul>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(t)}>
                    <Pencil className="size-3.5" /> Ubah
                  </Button>
                  <Button size="sm" variant="outline" aria-label={`Hapus tier ${t.name}`} onClick={() => remove(t)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data && data.recent_changes.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-foreground">Perubahan tier terakhir</p>
          <ul className="divide-y divide-border">
            {data.recent_changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                {c.direction === "up" ? <ArrowUp className="size-4 text-nh-forest" /> : <ArrowDown className="size-4 text-destructive" />}
                <span className="min-w-0 flex-1 basis-40 font-medium text-foreground">{c.customer_name ?? c.phone ?? "—"}</span>
                <span className="text-muted-foreground">
                  {c.from_tier_name ?? "Tanpa tier"} → {c.to_tier_name ?? "Tanpa tier"}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{rupiah(c.spend_12m)}</span>
                <span className="text-xs text-muted-foreground">{tanggal(c.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {f && (
        <FormModal
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title={editing?.id ? `Ubah tier ${f.name || ""}` : "Tambah tier Membership"}
          description="Benefit terstruktur diterapkan otomatis oleh sistem; perks lain tampil di Member App dan dipenuhi staf."
          size="md"
          submitLabel="Simpan"
          cancelLabel="Batal"
          loadingLabel="Menyimpan..."
          loading={busy}
          submitDisabled={!valid}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mt-name">Nama tier</Label>
              <Input id="mt-name" maxLength={40} placeholder="mis. Gold" value={f.name} onChange={(e) => setF({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-min">Ambang spending 12 bulan (Rp)</Label>
              <Input id="mt-min" type="number" min={0} step={100000} placeholder="mis. 10000000" value={f.min_spend} onChange={(e) => setF({ min_spend: e.target.value })} />
              <p className="text-xs text-muted-foreground">{f.min_spend !== "" ? rupiah(Number(f.min_spend) || 0) : "Isi 0 untuk tier dasar."}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-color">Warna</Label>
              <div className="flex items-center gap-2">
                <input
                  id="mt-color"
                  type="color"
                  className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
                  value={/^#[0-9a-fA-F]{6}$/.test(f.display_color) ? f.display_color : "#DAFF59"}
                  onChange={(e) => setF({ display_color: e.target.value })}
                />
                <Input className="w-28" value={f.display_color} onChange={(e) => setF({ display_color: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-disc">Diskon F&B / POS (%)</Label>
              <Input id="mt-disc" type="number" min={0} max={100} value={f.discount_percent} onChange={(e) => setF({ discount_percent: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-early">Booking dibuka lebih awal (hari)</Label>
              <Input id="mt-early" type="number" min={0} max={14} value={f.early_booking_days} onChange={(e) => setF({ early_booking_days: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-cancel">Batas batal khusus (jam)</Label>
              <Input id="mt-cancel" type="number" min={0} max={72} placeholder="Ikut Aturan Booking" value={f.cancel_window_hours} onChange={(e) => setF({ cancel_window_hours: e.target.value })} />
              <p className="text-xs text-muted-foreground">Hanya dipakai bila lebih longgar dari Aturan Booking.</p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 sm:col-span-2">
              <span>
                <span className="block text-sm font-medium text-foreground">Prioritas waitlist</span>
                <span className="block text-xs text-muted-foreground">Didahulukan saat naik dari waitlist.</span>
              </span>
              <Switch checked={f.waitlist_priority} onCheckedChange={(v) => setF({ waitlist_priority: v })} aria-label="Prioritas waitlist" />
            </label>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Perks lain (tampil di Member App)</Label>
              <div className="space-y-2">
                {f.perks.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      maxLength={120}
                      placeholder="mis. Guest pass gratis 1x / bulan"
                      value={p}
                      onChange={(e) => setF({ perks: f.perks.map((x, j) => (j === i ? e.target.value : x)) })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label="Hapus perk"
                      onClick={() => setF({ perks: f.perks.length > 1 ? f.perks.filter((_, j) => j !== i) : [""] })}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                {f.perks.length < 12 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setF({ perks: [...f.perks, ""] })}>
                    <Plus className="size-3.5" /> Tambah perk
                  </Button>
                )}
              </div>
            </div>
          </div>
        </FormModal>
      )}
    </section>
  );
}
