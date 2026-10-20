"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Hourglass, ShieldAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { MemberLink } from "@/features/gym/members/member-link";
import { wibToday } from "@/features/gym/reports/params";
import { SELECT } from "@/features/gym/shared";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import {
  PAGE_SIZE,
  REASON_LABELS,
  REFERRAL_KEYS,
  STATUS_LABELS,
  campaignLabel,
  listQuery,
  referralsApi,
  type ReferralRow,
  type ReferralSettings,
  type ReferralStatus,
  type SettingsView,
} from "../api";

const STATUS_VARIANT: Record<ReferralStatus, "info" | "warning" | "success" | "muted" | "destructive"> = {
  joined: "info",
  held: "warning",
  rewarded: "success",
  capped: "muted",
  void: "muted",
  blocked: "destructive",
};

/** Gym → Referral: daftar referral, leaderboard bulanan, dan pengaturan program. */
export function ReferralsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Referral"
        description="Member mengajak teman dengan kode. Hadiah keluar setelah pembelian pertama teman lewat masa tahan tanpa refund."
      />
      <Tabs defaultValue="daftar" className="w-full flex-col">
        <TabsList variant="line">
          <TabsTrigger value="daftar">Daftar referral</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="pengaturan">Pengaturan</TabsTrigger>
        </TabsList>
        <TabsContent value="daftar" className="mt-4">
          <ReferralList />
        </TabsContent>
        <TabsContent value="leaderboard" className="mt-4">
          <Leaderboard />
        </TabsContent>
        <TabsContent value="pengaturan" className="mt-4">
          <SettingsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReferralList() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const query = listQuery(status, search, page);
  const list = useQuery({ queryKey: REFERRAL_KEYS.list(query), queryFn: () => referralsApi.list(query), placeholderData: keepPreviousData });
  const counts = list.data?.counts;
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Terdaftar dengan kode" value={formatNumber(counts?.joined ?? 0)} icon={<UserPlus />} />
        <StatCard label="Dalam masa tahan" value={formatNumber(counts?.held ?? 0)} icon={<Hourglass />} tone="warning" />
        <StatCard label="Dapat hadiah" value={formatNumber(counts?.rewarded ?? 0)} hint={`${formatNumber(counts?.capped ?? 0)} melewati batas bulanan`} icon={<Gift />} tone="success" />
        <StatCard label="Diblokir atau batal" value={formatNumber((counts?.blocked ?? 0) + (counts?.void ?? 0))} icon={<ShieldAlert />} tone="danger" />
      </div>
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Status">
            <select
              className={SELECT}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Semua status</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cari">
            <Input
              value={search}
              placeholder="Nama, nomor, atau kode"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </Field>
        </div>
      </Card>
      <Card className="py-0">
        {list.isLoading ? (
          <TableNote>Memuat referral…</TableNote>
        ) : list.error ? (
          <TableNote tone="danger">{list.error.message}</TableNote>
        ) : !list.data || list.data.rows.length === 0 ? (
          <TableNote>Belum ada referral.</TableNote>
        ) : (
          <Table aria-label="Daftar referral">
            <TableHeader>
              <TableRow>
                <TableHead>Pengajak</TableHead>
                <TableHead>Teman</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Daftar</TableHead>
                <TableHead>Pembelian pertama</TableHead>
                <TableHead className="text-right">Hadiah</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((r) => (
                <ReferralRowView key={r.id} row={r} />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </Button>
          <span className="tabular-nums text-muted-foreground">
            {page + 1} / {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Berikutnya
          </Button>
        </div>
      )}
    </div>
  );
}

function ReferralRowView({ row }: { row: ReferralRow }) {
  const reward = [
    row.referrer_credits > 0 ? `${row.referrer_credits} kredit pengajak` : "",
    row.referrer_ark_idr > 0 ? `${formatRupiah(row.referrer_ark_idr)} ARK` : "",
    row.referee_credits > 0 ? `${row.referee_credits} kredit teman` : "",
  ].filter(Boolean);
  return (
    <TableRow>
      <TableCell>
        <MemberLink id={row.referrer.id} name={row.referrer.name || null} />
        <div className="text-xs text-muted-foreground">{row.code}</div>
      </TableCell>
      <TableCell>
        <MemberLink id={row.referee.id} name={row.referee.name || null} />
        <div className="text-xs text-muted-foreground">{row.referee.phone}</div>
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABELS[row.status]}</Badge>
        {row.reason && <div className="mt-1 text-xs text-muted-foreground">{REASON_LABELS[row.reason] ?? row.reason}</div>}
        {row.status === "held" && row.hold_until && (
          <div className="mt-1 text-xs text-muted-foreground">Cair {formatDate(row.hold_until)}</div>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">{formatDate(row.created_at)}</TableCell>
      <TableCell className="whitespace-nowrap">
        {row.purchase_total_idr != null ? (
          <>
            {formatRupiah(row.purchase_total_idr)}
            <div className="text-xs text-muted-foreground">{formatDate(row.qualified_at)}</div>
          </>
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell className="text-right text-xs">
        {reward.length > 0 ? reward.join(" · ") : "-"}
        {row.referee_voucher_code && <div className="text-muted-foreground">Voucher {row.referee_voucher_code}</div>}
      </TableCell>
    </TableRow>
  );
}

function Leaderboard() {
  const [month, setMonth] = useState(() => wibToday().slice(0, 7));
  const board = useQuery({ queryKey: REFERRAL_KEYS.leaderboard(month), queryFn: () => referralsApi.leaderboard(month) });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Field label="Bulan" className="max-w-xs">
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </Field>
      </Card>
      <Card className="py-0">
        {board.isLoading ? (
          <TableNote>Memuat leaderboard…</TableNote>
        ) : board.error ? (
          <TableNote tone="danger">{board.error.message}</TableNote>
        ) : !board.data || board.data.length === 0 ? (
          <TableNote>Belum ada referral di bulan ini.</TableNote>
        ) : (
          <Table aria-label="Leaderboard referral">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Member</TableHead>
                <TableHead className="text-right">Teman daftar</TableHead>
                <TableHead className="text-right">Beli paket</TableHead>
                <TableHead className="text-right">Dapat hadiah</TableHead>
                <TableHead className="text-right">Hadiah pengajak</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.data.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums">{i + 1}</TableCell>
                  <TableCell>
                    <MemberLink id={l.id} name={l.name || null} />
                    <div className="text-xs text-muted-foreground">{l.phone}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(l.invited)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(l.joined)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(l.rewarded)}</TableCell>
                  <TableCell className="text-right text-xs whitespace-nowrap">
                    {[l.credits > 0 ? `${l.credits} kredit` : "", l.ark_idr > 0 ? `${formatRupiah(l.ark_idr)} ARK` : ""].filter(Boolean).join(" · ") || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function SettingsSection() {
  const settings = useQuery({ queryKey: REFERRAL_KEYS.settings, queryFn: referralsApi.settings });
  if (settings.isLoading) {
    return (
      <Card>
        <TableNote>Memuat pengaturan…</TableNote>
      </Card>
    );
  }
  if (settings.error || !settings.data) {
    return (
      <Card>
        <TableNote tone="danger">{settings.error?.message ?? "Gagal memuat pengaturan"}</TableNote>
      </Card>
    );
  }
  // key: form dimuat ulang setelah tersimpan.
  return <SettingsForm key={JSON.stringify(settings.data.settings)} view={settings.data} />;
}

type NumberKey = "referrer_credits" | "referrer_ark_idr" | "referee_credits" | "credit_validity_days" | "hold_days" | "monthly_cap";

const NUMBER_FIELDS: { key: NumberKey; label: string; unit: string; hint: string; min: number; max: number }[] = [
  { key: "referrer_credits", label: "Kredit bonus pengajak", unit: "kredit", hint: "Per teman yang lolos masa tahan. 0 = tanpa kredit.", min: 0, max: 100 },
  { key: "referrer_ark_idr", label: "ARK Coin pengajak", unit: "rupiah", hint: "Masuk ke dompet ARK Coin pengajak. 0 = tanpa ARK Coin.", min: 0, max: 10_000_000 },
  { key: "referee_credits", label: "Kredit bonus teman", unit: "kredit", hint: "Untuk teman baru, keluar bersama hadiah pengajak.", min: 0, max: 100 },
  { key: "credit_validity_days", label: "Masa berlaku kredit bonus", unit: "hari", hint: "Dihitung dari hari hadiah keluar.", min: 1, max: 365 },
  { key: "hold_days", label: "Masa tahan", unit: "hari", hint: "Pembelian pertama harus bertahan tanpa refund selama ini sebelum hadiah keluar.", min: 0, max: 90 },
  { key: "monthly_cap", label: "Batas hadiah pengajak per bulan", unit: "teman", hint: "Lewat dari ini, teman tetap dapat hadiah tetapi pengajak tidak. 0 = tanpa batas.", min: 0, max: 1000 },
];

function SettingsForm({ view }: { view: SettingsView }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<ReferralSettings>(view.settings);
  const set = <K extends keyof ReferralSettings>(key: K, value: ReferralSettings[K]) => setValues((cur) => ({ ...cur, [key]: value }));

  const save = useMutation({
    mutationFn: () => referralsApi.saveSettings(values),
    onSuccess: (fresh) => {
      queryClient.setQueryData(REFERRAL_KEYS.settings, fresh);
      toast.success("Pengaturan referral disimpan");
    },
    onError: (error) => toast.error("Pengaturan gagal disimpan", { description: error.message }),
  });

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
          <li className="grid grid-cols-1 gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] md:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium">Program aktif</p>
              <p className="text-xs text-muted-foreground">Mati: kode baru tidak dicatat. Referral yang sudah tercatat tetap diproses sampai selesai.</p>
            </div>
            <Switch checked={values.is_active} onCheckedChange={(on) => set("is_active", on)} aria-label="Program referral aktif" />
          </li>
          {NUMBER_FIELDS.map((f) => (
            <li key={f.key} className="grid grid-cols-1 gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] md:items-center">
              <div className="min-w-0">
                <label htmlFor={`referral-${f.key}`} className="text-sm font-medium">
                  {f.label}
                </label>
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id={`referral-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={f.max}
                  value={values[f.key]}
                  onChange={(e) => set(f.key, Number(e.target.value))}
                />
                <span className="shrink-0 text-xs text-muted-foreground">{f.unit}</span>
              </div>
            </li>
          ))}
          <li className="grid grid-cols-1 gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] md:items-center">
            <div className="min-w-0">
              <label htmlFor="referral-campaign" className="text-sm font-medium">
                Diskon paket pertama untuk teman
              </label>
              <p className="text-xs text-muted-foreground">
                Teman baru mendapat satu kode voucher sekali pakai dari campaign promo ini (scope gym atau semua). Atur besar diskon di Promo.
              </p>
            </div>
            <select
              id="referral-campaign"
              className={SELECT}
              value={values.referee_campaign_id ?? ""}
              onChange={(e) => set("referee_campaign_id", e.target.value || null)}
            >
              <option value="">Tanpa diskon</option>
              {view.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {campaignLabel(c, formatRupiah)}
                </option>
              ))}
            </select>
          </li>
        </ul>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          Simpan pengaturan
        </Button>
      </div>
    </form>
  );
}
