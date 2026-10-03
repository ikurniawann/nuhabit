"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Coins } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeBadgeRule } from "@/lib/crm/badges";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { memberEngagementApi, type MemberActivity, type MemberBadgeRow } from "../engagement-api";
import { membersQueryKeys } from "../query-keys";

const angka = (n: number | null | undefined) => Number(n || 0).toLocaleString("id-ID");
const waktu = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      })
    : "-";

const key = (customerId: string, part: string) => ["crm", "members", "engagement", customerId, part];

/**
 * Aktivitas member di detail CRM: check-in, booking event, challenge,
 * notifikasi, dompet ARK, badge (beri/cabut), persetujuan komunikasi, dan
 * penyesuaian XP manual dengan alasan.
 */
export function MemberEngagementPanel({ customerId, memberKey }: { customerId: string; memberKey: string }) {
  const [adjusting, setAdjusting] = useState(false);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="text-base font-semibold">Aktivitas & loyalti</h3>
          <p className="text-sm text-muted-foreground">Riwayat member di portal dan kasir, badge, serta persetujuan.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAdjusting(true)}>
          <Coins /> Sesuaikan XP
        </Button>
      </div>
      <Tabs defaultValue="checkins" className="pt-3">
        <TabsList variant="line" className="mx-5">
          <TabsTrigger value="checkins">Check-in</TabsTrigger>
          <TabsTrigger value="bookings">Event</TabsTrigger>
          <TabsTrigger value="challenges">Challenge</TabsTrigger>
          <TabsTrigger value="notifications">Notifikasi</TabsTrigger>
          <TabsTrigger value="wallet">Dompet ARK</TabsTrigger>
          <TabsTrigger value="badges">Badge</TabsTrigger>
          <TabsTrigger value="consent">Persetujuan</TabsTrigger>
        </TabsList>
        <TabsContent value="checkins">
          <ActivityTable customerId={customerId} tab="checkins" empty="Belum pernah check-in dengan QR." head={["Waktu", "Hasil", "Kasir"]}>
            {(row) => [
              waktu(row.created_at),
              row.decision === "accepted" ? (
                <Badge variant="success">Diterima</Badge>
              ) : (
                <Badge variant="destructive">Ditolak · {row.reason === "expired" ? "kedaluwarsa" : row.reason === "consumed" ? "sudah dipakai" : "tidak dikenal"}</Badge>
              ),
              row.cashier_name ?? "-",
            ]}
          </ActivityTable>
        </TabsContent>
        <TabsContent value="bookings">
          <ActivityTable customerId={customerId} tab="bookings" empty="Belum pernah mendaftar event." head={["Event", "Jadwal", "Status"]}>
            {(row) => [
              <span key="t" className="font-medium">{row.title}</span>,
              waktu(row.starts_at),
              <Badge key="s" variant={row.status === "attended" ? "success" : row.status === "cancelled" || row.status === "no_show" ? "muted" : "info"}>
                {BOOKING_LABELS[row.status]}
                {row.status === "waitlist" && row.waitlist_position ? ` #${row.waitlist_position}` : ""}
                {row.late_cancel ? " · terlambat" : ""}
              </Badge>,
            ]}
          </ActivityTable>
        </TabsContent>
        <TabsContent value="challenges">
          <ActivityTable customerId={customerId} tab="challenges" empty="Belum ikut challenge." head={["Challenge", "Target", "Status"]}>
            {(row) => [
              <span key="t" className="font-medium">{row.title}</span>,
              row.metric === "spend" ? `Belanja Rp ${angka(row.target)}` : `${angka(row.target)} kunjungan`,
              row.rewarded_at ? (
                <Badge variant="success">Selesai {waktu(row.rewarded_at)}</Badge>
              ) : new Date(row.ends_at) < new Date() ? (
                <Badge variant="muted">Berakhir</Badge>
              ) : (
                <Badge variant="info">Berjalan</Badge>
              ),
            ]}
          </ActivityTable>
        </TabsContent>
        <TabsContent value="notifications">
          <ActivityTable customerId={customerId} tab="notifications" empty="Belum ada notifikasi terkirim." head={["Notifikasi", "Dikirim", "Status"]}>
            {(row) => [
              <div key="n" className="max-w-sm whitespace-normal">
                <p className="font-medium">{row.title}</p>
                <p className="text-xs text-muted-foreground">{row.campaign_name ? `Kampanye: ${row.campaign_name}` : row.type}</p>
              </div>,
              waktu(row.created_at),
              row.clicked_at ? (
                <Badge variant="success">Diklik</Badge>
              ) : row.opened_at ? (
                <Badge variant="info">Dibuka</Badge>
              ) : row.read_at ? (
                <Badge variant="secondary">Dibaca</Badge>
              ) : (
                <Badge variant="outline">Belum dibaca</Badge>
              ),
            ]}
          </ActivityTable>
        </TabsContent>
        <TabsContent value="wallet">
          <ActivityTable customerId={customerId} tab="wallet" empty="Belum ada transaksi dompet." head={["Transaksi", "Waktu", "Nominal"]}>
            {(row) => [
              <div key="w" className="max-w-xs whitespace-normal">
                <p className="font-medium">{WALLET_LABELS[row.type] ?? row.type}</p>
                <p className="text-xs text-muted-foreground">
                  {[row.status !== "completed" ? row.status : null, row.notes].filter(Boolean).join(" · ") || "-"}
                </p>
              </div>,
              waktu(row.created_at),
              <span key="a" className="tabular-nums">
                Rp {angka(row.amount)}
                {row.balance_after != null && (
                  <span className="block text-xs text-muted-foreground">saldo Rp {angka(row.balance_after)}</span>
                )}
              </span>,
            ]}
          </ActivityTable>
        </TabsContent>
        <TabsContent value="badges">
          <BadgesTab customerId={customerId} />
        </TabsContent>
        <TabsContent value="consent">
          <ConsentTab customerId={customerId} />
        </TabsContent>
      </Tabs>
      {adjusting && (
        <XpAdjustDialog customerId={customerId} memberKey={memberKey} onClose={() => setAdjusting(false)} />
      )}
    </Card>
  );
}

const BOOKING_LABELS = {
  confirmed: "Terdaftar",
  waitlist: "Waitlist",
  cancelled: "Batal",
  attended: "Hadir",
  no_show: "Tidak hadir",
} as const;

const WALLET_LABELS: Record<string, string> = {
  topup: "Top up",
  topup_bonus: "Bonus top up",
  refund: "Refund",
  bonus: "Bonus",
  payment: "Pembayaran",
  purchase: "Pembayaran",
};

function ActivityTable<K extends keyof MemberActivity>({
  customerId,
  tab,
  head,
  empty,
  children,
}: {
  customerId: string;
  tab: K;
  head: [string, string, string];
  empty: string;
  children: (row: MemberActivity[K]) => [ReactNode, ReactNode, ReactNode];
}) {
  const query = useQuery({
    queryKey: key(customerId, tab),
    queryFn: () => memberEngagementApi.activity(customerId, tab),
  });
  if (query.isLoading) return <TableNote>Memuat…</TableNote>;
  if (query.error) return <TableNote tone="danger">{query.error.message}</TableNote>;
  const rows = query.data ?? [];
  if (rows.length === 0) return <TableNote>{empty}</TableNote>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h, i) => (
            <TableHead key={h} className={i === 2 ? "text-right" : undefined}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const [a, b, c] = children(row);
          return (
            <TableRow key={(row as { id: string }).id}>
              <TableCell>{a}</TableCell>
              <TableCell className="text-muted-foreground">{b}</TableCell>
              <TableCell className="text-right">{c}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function BadgesTab({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const badges = useQuery({ queryKey: key(customerId, "badges"), queryFn: () => memberEngagementApi.badges(customerId) });
  const change = useMutation({
    mutationFn: (input: { badge: MemberBadgeRow; action: "award" | "revoke" }) =>
      memberEngagementApi.changeBadge(customerId, {
        badge_id: input.badge.id,
        action: input.action,
        reason: input.action === "revoke" ? "Dicabut dari detail member" : undefined,
      }),
    onSuccess: (result) => {
      toast.success(result.message ?? "Badge diperbarui");
      void queryClient.invalidateQueries({ queryKey: key(customerId, "badges") });
    },
    onError: (error) => toast.error("Badge gagal diubah", { description: error.message }),
  });

  if (badges.isLoading) return <TableNote>Memuat badge…</TableNote>;
  if (badges.error) return <TableNote tone="danger">{badges.error.message}</TableNote>;
  const rows = badges.data ?? [];
  if (rows.length === 0) return <TableNote>Belum ada badge aktif. Buat di CRM → Badges.</TableNote>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Badge</TableHead>
          <TableHead className="hidden md:table-cell">Syarat</TableHead>
          <TableHead className="text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((badge) => {
          const owned = badge.awarded_at !== null;
          return (
            <TableRow key={badge.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Award className="size-4 text-muted-foreground" />
                  <span className="font-medium">{badge.name}</span>
                </div>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">
                {describeBadgeRule(badge)}
                {badge.bonus_xp > 0 ? ` · bonus ${angka(badge.bonus_xp)} XP` : ""}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {owned ? (
                    <Badge variant="success">{badge.source === "manual" ? "Diberikan admin" : "Diraih"} {waktu(badge.awarded_at)}</Badge>
                  ) : badge.revoked_at ? (
                    <Badge variant="muted">Dicabut</Badge>
                  ) : null}
                  <Button
                    size="sm"
                    variant={owned ? "ghost" : "soft"}
                    className={owned ? "text-danger" : undefined}
                    disabled={change.isPending}
                    onClick={() => change.mutate({ badge, action: owned ? "revoke" : "award" })}
                  >
                    {owned ? "Cabut" : "Berikan"}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ConsentTab({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const consent = useQuery({ queryKey: key(customerId, "consent"), queryFn: () => memberEngagementApi.consent(customerId) });
  const save = useMutation({
    mutationFn: (input: { wa_consent?: boolean; marketing_opt_out?: boolean }) =>
      memberEngagementApi.saveConsent(customerId, input),
    onSuccess: (result) => {
      queryClient.setQueryData(key(customerId, "consent"), result.data);
      toast.success("Persetujuan disimpan");
    },
    onError: (error) => toast.error("Persetujuan gagal disimpan", { description: error.message }),
  });

  if (consent.isLoading) return <TableNote>Memuat persetujuan…</TableNote>;
  if (consent.error || !consent.data) return <TableNote tone="danger">{consent.error?.message ?? "Data tidak tersedia"}</TableNote>;
  const data = consent.data;
  return (
    <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
      <ConsentRow
        title="Izin WhatsApp (portal)"
        hint={data.wa_verified_at ? `Nomor terverifikasi ${waktu(data.wa_verified_at)}` : "Nomor belum diverifikasi lewat OTP"}
        checked={data.wa_consent}
        disabled={save.isPending}
        onChange={(next) => save.mutate({ wa_consent: next })}
      />
      <ConsentRow
        title="Terima kampanye marketing"
        hint={
          data.marketing_opt_out
            ? `Opt-out ${data.optout_source === "keyword" ? "lewat balasan STOP" : "manual"} ${waktu(data.optout_at)}`
            : "Tidak ada di daftar opt-out; kampanye WA bisa dikirim"
        }
        checked={!data.marketing_opt_out}
        disabled={save.isPending}
        onChange={(next) => save.mutate({ marketing_opt_out: !next })}
      />
    </div>
  );
}

function ConsentRow({
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

function XpAdjustDialog({
  customerId,
  memberKey,
  onClose,
}: {
  customerId: string;
  memberKey: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // Satu id per dialog: klik ganda tidak menggandakan penyesuaian.
  const [requestId] = useState(() => crypto.randomUUID());
  const [direction, setDirection] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const delta = Math.floor(Number(amount) || 0) * (direction === "add" ? 1 : -1);

  const adjust = useMutation({
    mutationFn: () => memberEngagementApi.adjustXp(customerId, { delta, reason: reason.trim(), request_id: requestId }),
    onSuccess: (result) => {
      toast.success(result.message ?? "XP disesuaikan", {
        description: `XP sekarang ${angka(result.data.totalXp)}`,
      });
      void queryClient.invalidateQueries({ queryKey: membersQueryKeys.detail(memberKey) });
      onClose();
    },
    onError: (error) => toast.error("XP gagal disesuaikan", { description: error.message }),
  });
  const valid = delta !== 0 && reason.trim().length >= 5;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) adjust.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Sesuaikan XP</DialogPanelTitle>
            <DialogPanelDescription>
              Tercatat di riwayat XP beserta alasan dan nama Anda. Tier member dievaluasi ulang.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4">
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={direction === "add" ? "ink" : "outline"} onClick={() => setDirection("add")}>
                Tambah
              </Button>
              <Button
                type="button"
                size="sm"
                variant={direction === "subtract" ? "ink" : "outline"}
                onClick={() => setDirection("subtract")}
              >
                Kurangi
              </Button>
            </div>
            <Field label="Jumlah XP">
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label="Alasan" hint="Minimal 5 karakter, mis. kompensasi keluhan order #123.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || adjust.isPending}>
              {direction === "add" ? "Tambah" : "Kurangi"} {amount ? `${angka(Number(amount))} XP` : "XP"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
