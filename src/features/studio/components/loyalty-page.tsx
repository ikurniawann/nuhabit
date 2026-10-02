"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, Crown, Loader2, Lock, Search, ShieldCheck, Trophy, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiGet, apiPatch, apiPut } from "@/lib/api-client";
import type { ApiMessage } from "../types";
import { rupiah } from "../types";
import { NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

interface Rule {
  id: string;
  code: string;
  name: string;
  source_type: string;
  xp_mode: "fixed" | "per_amount";
  xp_value: number;
  amount_step: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

interface TierRow {
  id: string;
  code: string;
  name: string;
  min_lifetime_xp: number;
  discount_percent: number;
  display_color: string | null;
  members: number;
  benefits: { early_booking_days: number; cancel_window_hours: number | null; waitlist_priority: boolean };
}

interface LoyaltyData {
  rules: Rule[];
  tiers: TierRow[];
  issued_30d: { xp: number; members: number };
  leaderboard: { rank: number; alias: string; sessions: number; tier_name: string | null }[];
  ark_coin_enabled: boolean;
}

interface MemberRow {
  id: string;
  name: string | null;
  phone: string | null;
  lifetime_xp: number;
  xp_balance: number;
  status: "active" | "suspended" | "banned" | string;
  status_reason: string | null;
  tier_name: string | null;
}

const fmt = (n: number) => Number(n).toLocaleString("id-ID");
const HOURS = Array.from({ length: 19 }, (_, i) => `${String(i + 5).padStart(2, "0")}:00`);

export function StudioLoyaltyPage() {
  const [data, setData] = useState<LoyaltyData | null>(null);

  const load = useCallback(async () => {
    try {
      setData((await apiGet<{ data: LoyaltyData }>("/api/studio/loyalty")).data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="flex justify-center py-24 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const totalMembers = data.tiers.reduce((s, t) => s + t.members, 0);

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Program Loyalitas"
        subtitle="NüHabit Progress — XP dari konsistensi latihan, tier seumur hidup dengan benefit booking, dan leaderboard."
      />

      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<Zap className="size-4" />} label="XP dibagikan 30 hari" value={fmt(data.issued_30d.xp)} sub={`${fmt(data.issued_30d.members)} member mendapat XP`} />
        <Stat icon={<Crown className="size-4" />} label="Member ber-tier" value={fmt(totalMembers)} sub={data.tiers.map((t) => `${t.name} ${t.members}`).join(" · ")} />
        <Stat icon={<Trophy className="size-4" />} label="Puncak leaderboard" value={data.leaderboard[0]?.alias ?? "—"} sub={data.leaderboard[0] ? `${data.leaderboard[0].sessions} sesi bulan ini` : "Belum ada yang tampil"} />
        <Stat icon={<Lock className="size-4" />} label="ARK Coin" value={data.ark_coin_enabled ? "Aktif" : "Nonaktif"} sub="Saklar di CRM → Pengaturan (data tetap tersimpan)" />
      </div>

      <section className="mb-8">
        <h2 className="mb-1 font-display text-lg font-semibold text-foreground">Aturan XP</h2>
        <p className="mb-3 text-sm text-muted-foreground">XP hanya dari sesi yang benar-benar hadir. Perubahan berlaku untuk kejadian berikutnya.</p>
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5">Aktivitas</th>
                <th className="px-4 py-2.5">XP</th>
                <th className="px-4 py-2.5">Parameter</th>
                <th className="px-4 py-2.5">Aktif</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {data.rules.map((r) => (
                <RuleRow key={r.id} rule={r} onSaved={load} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 font-display text-lg font-semibold text-foreground">Tier & benefit</h2>
        <p className="mb-3 text-sm text-muted-foreground">Tier dari XP seumur hidup (tidak turun). Member diblokir/banned kehilangan benefit selama statusnya tidak aktif.</p>
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5">Tier</th>
                <th className="px-4 py-2.5">Mulai dari XP</th>
                <th className="px-4 py-2.5">Booking lebih awal</th>
                <th className="px-4 py-2.5">Batas batal</th>
                <th className="px-4 py-2.5">Prioritas waitlist</th>
                <th className="px-4 py-2.5">Diskon F&B</th>
                <th className="px-4 py-2.5 text-right">Member</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {data.tiers.map((t) => (
                <TierRowEditor key={t.id} tier={t} onSaved={load} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <MemberStatusSection />
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-foreground">Leaderboard bulan ini</h2>
          <div className="rounded-xl border border-border bg-card p-2 shadow-sm">
            {data.leaderboard.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Belum ada member yang memilih tampil.</p>
            ) : (
              <ol>
                {data.leaderboard.map((e, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
                    <span className="w-5 font-display font-bold text-foreground">{e.rank}</span>
                    <span className="flex-1 truncate">{e.alias}</span>
                    {e.tier_name && <Pill>{e.tier_name}</Pill>}
                    <span className="w-14 text-right tabular-nums text-muted-foreground">{e.sessions} sesi</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Hanya member yang memilih tampil (opt-in di Member App). Nama disamarkan, mis. &quot;Maya K.&quot;</p>
        </section>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-1 truncate font-display text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function RuleRow({ rule, onSaved }: { rule: Rule; onSaved: () => void }) {
  const [xp, setXp] = useState(String(rule.xp_value));
  const [step, setStep] = useState(String(rule.amount_step));
  const [active, setActive] = useState(rule.is_active);
  const [meta, setMeta] = useState<Record<string, unknown>>(rule.metadata ?? {});
  const [busy, setBusy] = useState(false);
  const dirty = Number(xp) !== rule.xp_value || Number(step) !== rule.amount_step || active !== rule.is_active || JSON.stringify(meta) !== JSON.stringify(rule.metadata ?? {});

  async function save() {
    setBusy(true);
    try {
      const res = await apiPatch<ApiMessage>(`/api/studio/loyalty/rules/${rule.id}`, {
        xp_value: Number(xp),
        amount_step: Number(step),
        is_active: active,
        metadata: meta,
      });
      toast.success(res.message ?? "Tersimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-border align-middle">
      <td className="px-4 py-2.5 font-medium text-foreground">{rule.name}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Input className="h-8 w-20" type="number" min={0} value={xp} onChange={(e) => setXp(e.target.value)} />
          {rule.xp_mode === "per_amount" && (
            <>
              <span className="text-xs text-muted-foreground">XP per</span>
              <Input className="h-8 w-28" type="number" min={1} value={step} onChange={(e) => setStep(e.target.value)} />
              <span className="text-xs text-muted-foreground">{rupiah(Number(step) || 0)}</span>
            </>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">
        {rule.code === "studio_weekly_streak" ? (
          <label className="flex items-center gap-2">
            Minimal
            <Input className="h-8 w-16" type="number" min={1} max={7} value={String(meta.min_sessions ?? 3)} onChange={(e) => setMeta({ ...meta, min_sessions: Number(e.target.value) })} />
            sesi / minggu
          </label>
        ) : rule.code === "studio_offpeak" ? (
          <label className="flex items-center gap-2">
            Kelas mulai
            <NativeSelect className="h-8 w-24" value={String(meta.start ?? "10:00")} onChange={(e) => setMeta({ ...meta, start: e.target.value })}>
              {HOURS.map((h) => (
                <option key={h} value={h}>{h.replace(":", ".")}</option>
              ))}
            </NativeSelect>
            sampai sebelum
            <NativeSelect className="h-8 w-24" value={String(meta.end ?? "16:00")} onChange={(e) => setMeta({ ...meta, end: e.target.value })}>
              {HOURS.map((h) => (
                <option key={h} value={h}>{h.replace(":", ".")}</option>
              ))}
            </NativeSelect>
          </label>
        ) : rule.code === "studio_early_renewal" ? (
          "Beli paket baru saat paket lain masih berlaku"
        ) : rule.code === "studio_streak_4w" ? (
          "Setiap kelipatan 4 minggu streak berturut-turut"
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-2.5">
        <Switch checked={active} onCheckedChange={setActive} aria-label={`Aktifkan ${rule.name}`} />
      </td>
      <td className="px-4 py-2.5 text-right">
        <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || busy} onClick={save}>
          {busy && <Loader2 className="size-3.5 animate-spin" />} Simpan
        </Button>
      </td>
    </tr>
  );
}

function TierRowEditor({ tier, onSaved }: { tier: TierRow; onSaved: () => void }) {
  const init = {
    name: tier.name,
    min: String(tier.min_lifetime_xp),
    early: String(tier.benefits.early_booking_days),
    cancel: tier.benefits.cancel_window_hours === null ? "" : String(tier.benefits.cancel_window_hours),
    priority: tier.benefits.waitlist_priority,
    discount: String(tier.discount_percent),
  };
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);

  async function save() {
    setBusy(true);
    try {
      const res = await apiPatch<ApiMessage>(`/api/studio/loyalty/tiers/${tier.id}`, {
        name: f.name.trim(),
        min_lifetime_xp: Number(f.min),
        early_booking_days: Number(f.early),
        cancel_window_hours: f.cancel === "" ? null : Number(f.cancel),
        waitlist_priority: f.priority,
        discount_percent: Number(f.discount),
      });
      toast.success(res.message ?? "Tersimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-border align-middle">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-full" style={{ background: tier.display_color ?? undefined }} />
          <Input className="h-8 w-28" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Input className="h-8 w-24" type="number" min={0} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Input className="h-8 w-16" type="number" min={0} max={14} value={f.early} onChange={(e) => setF({ ...f, early: e.target.value })} />
          <span className="text-xs text-muted-foreground">hari</span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Input className="h-8 w-16" type="number" min={0} max={72} placeholder="—" value={f.cancel} onChange={(e) => setF({ ...f, cancel: e.target.value })} />
          <span className="text-xs text-muted-foreground">jam</span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Switch checked={f.priority} onCheckedChange={(v) => setF({ ...f, priority: v })} aria-label="Prioritas waitlist" />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Input className="h-8 w-16" type="number" min={0} max={100} value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{tier.members}</td>
      <td className="px-4 py-2.5 text-right">
        <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || busy} onClick={save}>
          {busy && <Loader2 className="size-3.5 animate-spin" />} Simpan
        </Button>
      </td>
    </tr>
  );
}

const STATUS_LABEL: Record<string, string> = { active: "Aktif", suspended: "Diblokir", banned: "Banned", inactive: "Nonaktif" };

function MemberStatusSection() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const search = useCallback(async (term: string) => {
    try {
      setRows((await apiGet<{ data: MemberRow[] }>(`/api/studio/loyalty/members?q=${encodeURIComponent(term)}`)).data);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void search(q), 300);
    return () => clearTimeout(t);
  }, [q, search]);

  async function setStatus(m: MemberRow, status: "active" | "suspended" | "banned") {
    let reason: string | null = null;
    if (status !== "active") {
      reason = prompt(`${status === "banned" ? "Banned" : "Blokir"} ${m.name ?? m.phone}? Tulis alasannya:`);
      if (!reason?.trim()) return;
    } else if (!confirm(`Aktifkan kembali ${m.name ?? m.phone}? Tier & benefit dipulihkan.`)) return;
    setBusy(m.id);
    try {
      const res = await apiPut<ApiMessage>(`/api/studio/loyalty/members/${m.id}/status`, { status, reason });
      toast.success(res.message ?? "Tersimpan");
      void search(q);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h2 className="mb-1 font-display text-lg font-semibold text-foreground">Status member</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        <strong>Diblokir</strong>: tier, benefit, XP & reward dibekukan (pulih saat diaktifkan). <strong>Banned</strong>: juga tidak bisa booking.
      </p>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Cari nama atau nomor HP — kosongkan untuk melihat yang diblokir/banned" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5">Member</th>
              <th className="px-4 py-2.5">Tier</th>
              <th className="px-4 py-2.5 text-right">XP total</th>
              <th className="px-4 py-2.5 text-right">Saldo</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto size-4 animate-spin" /></td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">{q ? "Tidak ditemukan." : "Tidak ada member yang diblokir atau banned."}</td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-foreground">{m.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{m.phone}</p>
                  </td>
                  <td className="px-4 py-2.5">{m.tier_name ?? "Starter"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(m.lifetime_xp)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(m.xp_balance)}</td>
                  <td className="px-4 py-2.5">
                    <Pill tone={m.status === "active" ? "positive" : m.status === "banned" ? "danger" : "warning"}>{STATUS_LABEL[m.status] ?? m.status}</Pill>
                    {m.status_reason && <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">{m.status_reason}</p>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      {m.status !== "active" ? (
                        <Button size="sm" variant="outline" disabled={busy === m.id} onClick={() => setStatus(m, "active")}>
                          <ShieldCheck className="size-3.5" /> Aktifkan
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" disabled={busy === m.id} onClick={() => setStatus(m, "suspended")}>
                            <Lock className="size-3.5" /> Blokir
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy === m.id} onClick={() => setStatus(m, "banned")}>
                            <Ban className="size-3.5" /> Banned
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
