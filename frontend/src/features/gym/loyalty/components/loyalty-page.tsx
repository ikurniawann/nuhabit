"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Pencil, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Can } from "@/components/iam/can";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { MemberLink } from "@/features/gym/members/member-link";
import { wibToday } from "@/features/gym/reports/params";
import { SELECT } from "@/features/gym/shared";
import { useDebounced } from "@/features/gym/use-debounced";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import {
  LOYALTY_KEYS,
  STATUS_LABELS,
  loyaltyApi,
  minutesToTime,
  perkLines,
  timeToMinutes,
  type BranchOffPeak,
  type LoyaltySettings,
  type StatusRow,
  type TierInput,
  type TierRow,
  type TiersView,
} from "../api";
import { StatusBadge, StatusDialog } from "./member-loyalty";

const MENU = "gym.loyalty";

/** Gym → Membership & Progres: tier dari belanja 12 bulan, nilai XP kehadiran, status member, leaderboard. */
export function LoyaltyPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Membership & Progres"
        description="Membership mengikuti belanja 12 bulan terakhir (paket gym, POS, toko online, dikurangi refund). Progres mengikuti XP dari kehadiran dan belanja. Bila keduanya memberi perk yang sama, member mendapat yang lebih baik."
      />
      <Tabs defaultValue="tier" className="w-full flex-col">
        <TabsList variant="line">
          <TabsTrigger value="tier">Tier membership</TabsTrigger>
          <TabsTrigger value="xp">XP & pengaturan</TabsTrigger>
          <TabsTrigger value="status">Status member</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
        </TabsList>
        <TabsContent value="tier" className="mt-4">
          <TierSection />
        </TabsContent>
        <TabsContent value="xp" className="mt-4">
          <SettingsSection />
        </TabsContent>
        <TabsContent value="status" className="mt-4">
          <StatusSection />
        </TabsContent>
        <TabsContent value="leaderboard" className="mt-4">
          <LeaderboardSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useTiers() {
  return useQuery({ queryKey: LOYALTY_KEYS.tiers, queryFn: loyaltyApi.tiers });
}

function TierSection() {
  const queryClient = useQueryClient();
  const tiers = useTiers();
  const [editing, setEditing] = useState<TierRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<TierRow | null>(null);

  const recompute = useMutation({
    mutationFn: loyaltyApi.recompute,
    onSuccess: ({ changed }) => {
      void queryClient.invalidateQueries({ queryKey: LOYALTY_KEYS.tiers });
      toast.success(`Tier dihitung ulang, ${formatNumber(changed)} member berganti tier`);
    },
    onError: (error) => toast.error("Hitung ulang gagal", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => loyaltyApi.deleteTier(id),
    onSuccess: () => {
      setDeleting(null);
      recompute.mutate();
    },
    onError: (error) => toast.error("Tier gagal dihapus", { description: error.message }),
  });

  if (tiers.isLoading) return <Card><TableNote>Memuat tier…</TableNote></Card>;
  if (tiers.error || !tiers.data) return <Card><TableNote tone="danger">{tiers.error?.message ?? "Gagal memuat tier"}</TableNote></Card>;
  const rows = tiers.data.tiers;
  const holders = rows.reduce((n, t) => n + t.members, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Tier aktif" value={formatNumber(rows.length)} icon={<Crown />} tone="ink" />
        <StatCard label="Member bertier" value={formatNumber(holders)} icon={<Users />} />
        <StatCard
          label="Masa tahan tier"
          value={`${formatNumber(tiers.data.settings.tier_hold_months)} bulan`}
          hint="Tier bertahan selama ini setelah terakhir memenuhi ambang"
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Can menu={MENU} action="update" mode="disable">
          <Button variant="outline" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
            <RefreshCw /> Hitung ulang semua member
          </Button>
        </Can>
        <Can menu={MENU} action="create" mode="disable">
          <Button onClick={() => setEditing("new")}>
            <Plus /> Tambah tier
          </Button>
        </Can>
      </div>
      <Card className="py-0">
        {rows.length === 0 ? (
          <TableNote>Belum ada tier. Tambah tier pertama dengan ambang belanja 12 bulan dan perks-nya.</TableNote>
        ) : (
          <Table aria-label="Tier membership">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Belanja 12 bulan</TableHead>
                <TableHead>Perks</TableHead>
                <TableHead className="text-right">Member</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="tabular-nums">{t.rank}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 font-medium">
                      <span aria-hidden className="size-3 rounded-full border border-border" style={{ background: t.color ?? "transparent" }} />
                      {t.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{formatRupiah(t.min_spend_idr)}</TableCell>
                  <TableCell className="text-xs">
                    {[...perkLines(t), ...t.perks].join(" · ") || "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(t.members)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Can menu={MENU} action="update">
                        <Button variant="ghost" size="icon-sm" aria-label={`Ubah ${t.name}`} onClick={() => setEditing(t)}>
                          <Pencil />
                        </Button>
                      </Can>
                      <Can menu={MENU} action="delete">
                        <Button variant="ghost" size="icon-sm" aria-label={`Hapus ${t.name}`} onClick={() => setDeleting(t)}>
                          <Trash2 />
                        </Button>
                      </Can>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && (
        <TierDialog
          tier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            recompute.mutate();
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Hapus tier ${deleting?.name ?? ""}?`}
        description="Member di tier ini turun ke tier yang sesuai belanjanya saat dihitung ulang. Riwayat tier tetap menyimpan namanya."
        confirmLabel="Hapus tier"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

const EMPTY_TIER: TierInput = {
  name: "",
  color: "#1F3D2B",
  min_spend_idr: 0,
  discount_percent: 0,
  early_booking_days: 0,
  cancel_window_hours: null,
  waitlist_priority: false,
  perks: [],
};

function TierDialog({ tier, onClose, onSaved }: { tier: TierRow | null; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<TierInput>(tier ?? EMPTY_TIER);
  const [perksText, setPerksText] = useState((tier?.perks ?? []).join("\n"));
  const set = <K extends keyof TierInput>(key: K, value: TierInput[K]) => setValues((cur) => ({ ...cur, [key]: value }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...values, perks: perksText.split("\n") };
      return tier ? loyaltyApi.updateTier(tier.id, body) : loyaltyApi.createTier(body);
    },
    onSuccess: () => {
      toast.success(tier ? "Tier diperbarui" : "Tier ditambahkan");
      onSaved();
    },
    onError: (error) => toast.error("Tier gagal disimpan", { description: error.message }),
  });
  const number = (key: "min_spend_idr" | "discount_percent" | "early_booking_days") => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(key, Number(e.target.value));

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={tier ? `Ubah tier ${tier.name}` : "Tambah tier"}
      description="Member naik tier begitu belanja 12 bulannya mencapai ambang. Perks di bawah diterapkan sistem otomatis."
      size="md"
      submitLabel="Simpan tier"
      cancelLabel="Batal"
      loadingLabel="Menyimpan…"
      loading={save.isPending}
      submitDisabled={!values.name.trim()}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nama tier">
          <Input value={values.name} maxLength={40} onChange={(e) => set("name", e.target.value)} placeholder="Gold" />
        </Field>
        <Field label="Warna">
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Warna tier"
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-card"
              value={values.color ?? "#1F3D2B"}
              onChange={(e) => set("color", e.target.value)}
            />
            <Input value={values.color ?? ""} onChange={(e) => set("color", e.target.value || null)} placeholder="#RRGGBB" />
          </div>
        </Field>
        <Field label="Ambang belanja 12 bulan (Rp)" hint="Paket gym, POS dan toko online, dikurangi refund">
          <Input type="number" inputMode="numeric" min={0} value={values.min_spend_idr} onChange={number("min_spend_idr")} />
        </Field>
        <Field label="Diskon POS & F&B (%)" hint="Yang lebih besar antara tier ini dan tier XP yang berlaku">
          <Input type="number" inputMode="decimal" min={0} max={100} step="0.5" value={values.discount_percent} onChange={number("discount_percent")} />
        </Field>
        <Field label="Booking lebih awal (hari)" hint="Ditambahkan ke jendela booking cabang">
          <Input type="number" inputMode="numeric" min={0} max={14} value={values.early_booking_days} onChange={number("early_booking_days")} />
        </Field>
        <Field label="Batas batal gratis (jam)" hint="Kosongkan untuk ikut aturan cabang. Hanya berlaku bila lebih pendek.">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={72}
            value={values.cancel_window_hours ?? ""}
            onChange={(e) => set("cancel_window_hours", e.target.value === "" ? null : Number(e.target.value))}
          />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Prioritas waitlist</p>
          <p className="text-xs text-muted-foreground">Kursi kosong ditawarkan ke tier tertinggi dulu, lalu urutan daftar.</p>
        </div>
        <Switch checked={values.waitlist_priority} onCheckedChange={(on) => set("waitlist_priority", on)} aria-label="Prioritas waitlist" />
      </div>
      <Field label="Perks lain" hint="Satu per baris, dipenuhi staf (guest pass, merchandise). Tampil di aplikasi member.">
        <Textarea rows={4} value={perksText} onChange={(e) => setPerksText(e.target.value)} placeholder={"Guest pass 1x per bulan\nHanduk gratis"} />
      </Field>
    </FormModal>
  );
}

type XPKey = Exclude<keyof LoyaltySettings, "tier_hold_months">;

const XP_FIELDS: { key: XPKey; label: string; unit: string; hint: string; min: number; max: number }[] = [
  { key: "xp_class_attended", label: "Hadir kelas", unit: "XP", hint: "Per kelas yang di-check-in.", min: 0, max: 10000 },
  { key: "xp_pt_attended", label: "Hadir Personal Training", unit: "XP", hint: "Per sesi PT yang di-check-in atau selesai.", min: 0, max: 10000 },
  { key: "xp_offpeak_bonus", label: "Bonus jam sepi", unit: "XP", hint: "Tambahan untuk kelas yang mulai di jam sepi cabang.", min: 0, max: 10000 },
  { key: "xp_weekly_streak", label: "Streak mingguan", unit: "XP", hint: "Sekali per minggu (Senin sampai Minggu) setelah sesi minimum tercapai.", min: 0, max: 10000 },
  { key: "weekly_streak_min_sessions", label: "Sesi minimum streak", unit: "sesi/minggu", hint: "Kelas dan PT dihitung.", min: 1, max: 14 },
  { key: "xp_streak_4w", label: "Streak 4 minggu", unit: "XP", hint: "Setiap kelipatan 4 minggu berturut-turut.", min: 0, max: 10000 },
  { key: "xp_purchase_per_step", label: "XP beli paket", unit: "XP", hint: "Per kelipatan nominal di bawah.", min: 0, max: 1000 },
  { key: "purchase_step_idr", label: "Kelipatan nominal", unit: "rupiah", hint: "Mis. 1 XP per Rp10.000.", min: 1000, max: 10_000_000 },
  { key: "xp_early_renewal", label: "Perpanjang lebih awal", unit: "XP", hint: "Beli paket saat paket sebelumnya masih berjalan.", min: 0, max: 10000 },
];

function SettingsSection() {
  const tiers = useTiers();
  if (tiers.isLoading) return <Card><TableNote>Memuat pengaturan…</TableNote></Card>;
  if (tiers.error || !tiers.data) return <Card><TableNote tone="danger">{tiers.error?.message ?? "Gagal memuat pengaturan"}</TableNote></Card>;
  return <SettingsForm key={JSON.stringify([tiers.data.settings, tiers.data.offpeak])} view={tiers.data} />;
}

interface OffPeakDraft {
  branch: BranchOffPeak;
  on: boolean;
  start: string;
  end: string;
}

function SettingsForm({ view }: { view: TiersView }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<LoyaltySettings>(view.settings);
  const [offpeak, setOffpeak] = useState<OffPeakDraft[]>(() =>
    view.offpeak.map((b) => ({
      branch: b,
      on: b.offpeak !== null,
      start: minutesToTime(b.offpeak?.starts_min ?? 600),
      end: minutesToTime(b.offpeak?.ends_min ?? 960),
    }))
  );
  const set = (key: keyof LoyaltySettings, value: number) => setValues((cur) => ({ ...cur, [key]: value }));
  const setDraft = (i: number, patch: Partial<OffPeakDraft>) => setOffpeak((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = useMutation({
    mutationFn: () =>
      loyaltyApi.saveSettings({
        ...values,
        offpeak: offpeak.map((d) => {
          const start = timeToMinutes(d.start);
          const end = timeToMinutes(d.end);
          return { branch_id: d.branch.branch_id, offpeak: d.on && start !== null && end !== null ? { starts_min: start, ends_min: end } : null };
        }),
      }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(LOYALTY_KEYS.tiers, fresh);
      toast.success("Pengaturan disimpan");
    },
    onError: (error) => toast.error("Pengaturan gagal disimpan", { description: error.message }),
  });

  const row = "grid grid-cols-1 gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] md:items-center";
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Card className="gap-0 py-2">
        <ul className="divide-y divide-border/60">
          <li className={row}>
            <div className="min-w-0">
              <label htmlFor="loyalty-hold" className="text-sm font-medium">Masa tahan tier</label>
              <p className="text-xs text-muted-foreground">Tier bertahan sekian bulan setelah member terakhir memenuhi ambangnya, walau belanja turun.</p>
            </div>
            <div className="flex items-center gap-2">
              <Input id="loyalty-hold" type="number" min={0} max={36} value={values.tier_hold_months} onChange={(e) => set("tier_hold_months", Number(e.target.value))} />
              <span className="shrink-0 text-xs text-muted-foreground">bulan</span>
            </div>
          </li>
          {XP_FIELDS.map((f) => (
            <li key={f.key} className={row}>
              <div className="min-w-0">
                <label htmlFor={`loyalty-${f.key}`} className="text-sm font-medium">{f.label}</label>
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
              <div className="flex items-center gap-2">
                <Input id={`loyalty-${f.key}`} type="number" inputMode="numeric" min={f.min} max={f.max} value={values[f.key]} onChange={(e) => set(f.key, Number(e.target.value))} />
                <span className="shrink-0 text-xs text-muted-foreground">{f.unit}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="gap-0 py-2">
        <div className="px-5 py-3">
          <p className="text-sm font-medium">Jam sepi per cabang</p>
          <p className="text-xs text-muted-foreground">Kelas yang mulai di jam ini (zona cabang) mendapat bonus jam sepi.</p>
        </div>
        <ul className="divide-y divide-border/60">
          {offpeak.map((d, i) => (
            <li key={d.branch.branch_id} className="grid grid-cols-1 gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_auto_8rem_8rem] md:items-center">
              <span className="text-sm">{d.branch.branch_name}</span>
              <Switch checked={d.on} onCheckedChange={(on) => setDraft(i, { on })} aria-label={`Jam sepi ${d.branch.branch_name}`} />
              <Input type="time" aria-label="Mulai" disabled={!d.on} value={d.start} onChange={(e) => setDraft(i, { start: e.target.value })} />
              <Input type="time" aria-label="Selesai" disabled={!d.on} value={d.end} onChange={(e) => setDraft(i, { end: e.target.value })} />
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex justify-end">
        <Can menu={MENU} action="update" mode="disable">
          <Button type="submit" disabled={save.isPending}>Simpan pengaturan</Button>
        </Can>
      </div>
    </form>
  );
}

function StatusSection() {
  const [search, setSearch] = useState("");
  const term = useDebounced(search, 300);
  const [target, setTarget] = useState<StatusRow | null>(null);
  const list = useQuery({ queryKey: LOYALTY_KEYS.members(term), queryFn: () => loyaltyApi.members(term) });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Field label="Cari member" hint="Kosongkan untuk melihat member yang sedang ditangguhkan atau diblokir.">
          <Input value={search} placeholder="Nama atau nomor HP" onChange={(e) => setSearch(e.target.value)} />
        </Field>
      </Card>
      <Card className="py-0">
        {list.isLoading ? (
          <TableNote>Memuat member…</TableNote>
        ) : list.error ? (
          <TableNote tone="danger">{list.error.message}</TableNote>
        ) : !list.data || list.data.length === 0 ? (
          <TableNote>{term ? "Member tidak ditemukan." : "Tidak ada member yang ditangguhkan atau diblokir."}</TableNote>
        ) : (
          <Table aria-label="Status member">
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Belanja 12 bulan</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((r) => (
                <TableRow key={r.customer_id}>
                  <TableCell>
                    <MemberLink id={r.customer_id} name={r.name} />
                    <div className="text-xs text-muted-foreground">{r.phone}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                    {r.status === "suspended" && r.suspended_until && (
                      <div className="mt-1 text-xs text-muted-foreground">sampai {formatDate(r.suspended_until)}</div>
                    )}
                    {r.status !== "active" && r.reason && <div className="mt-1 text-xs text-muted-foreground">{r.reason}</div>}
                  </TableCell>
                  <TableCell>{r.tier_name ?? "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(r.spend_12m_idr)}</TableCell>
                  <TableCell className="text-right">
                    <Can menu={MENU} action="update">
                      <Button variant="outline" size="sm" onClick={() => setTarget(r)}>Ubah status</Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {target && (
        <StatusDialog
          customerId={target.customer_id}
          name={target.name}
          current={{ status: target.status, reason: target.reason, suspended_until: target.suspended_until }}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

function LeaderboardSection() {
  const [branch, setBranch] = useState("");
  const [month, setMonth] = useState(() => wibToday().slice(0, 7));
  const board = useQuery({ queryKey: LOYALTY_KEYS.leaderboard(branch, month), queryFn: () => loyaltyApi.leaderboard(branch, month) });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Cabang">
            <select className={SELECT} value={branch || board.data?.branch?.id || ""} onChange={(e) => setBranch(e.target.value)}>
              {(board.data?.branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Bulan">
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </Field>
        </div>
      </Card>
      <Card className="py-0">
        {board.isLoading ? (
          <TableNote>Memuat leaderboard…</TableNote>
        ) : board.error ? (
          <TableNote tone="danger">{board.error.message}</TableNote>
        ) : !board.data || board.data.entries.length === 0 ? (
          <TableNote>Belum ada kehadiran di bulan ini.</TableNote>
        ) : (
          <Table aria-label="Leaderboard kehadiran">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Sesi hadir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.data.entries.map((e, i) => (
                <TableRow key={`${e.alias}-${i}`}>
                  <TableCell className="tabular-nums">{e.rank}</TableCell>
                  <TableCell>{e.alias}</TableCell>
                  <TableCell>{e.tier_name ? <Badge variant="muted">{e.tier_name}</Badge> : "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(e.sessions)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        Member yang mematikan tampil di leaderboard (pengaturan aplikasi member) serta member yang ditangguhkan atau diblokir tidak ditampilkan.
        {` Status: ${Object.values(STATUS_LABELS).join(", ")}.`}
      </p>
    </div>
  );
}
