"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Coins, Search, ShoppingCart, SlidersHorizontal, Ticket } from "lucide-react";
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
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import {
  ENTRY_LABELS,
  gymCreditsApi,
  METHOD_LABELS,
  type CreditEntry,
  type CreditPurchase,
  type MemberCredits,
  type PaymentMethod,
} from "../api";

const memberKey = (id: string) => ["gym-credits", "member", id];

const PURCHASE_BADGE: Record<CreditPurchase["status"], { label: string; variant: "success" | "info" | "muted" | "warning" }> = {
  paid: { label: "Lunas", variant: "success" },
  pending: { label: "Menunggu bayar", variant: "info" },
  failed: { label: "Gagal", variant: "muted" },
  expired: { label: "Kedaluwarsa", variant: "muted" },
  refunded: { label: "Direfund", variant: "warning" },
};

function useDebounced<T>(value: T, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Gym → Kredit Member: cari member, lihat saldo & lot, koreksi, jual paket di front desk. */
export function CreditsPage() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const term = useDebounced(q.trim());
  const hits = useQuery({
    queryKey: ["gym-credits", "search", term],
    queryFn: () => gymCreditsApi.searchMembers(term),
    enabled: term.length === 0 || term.length >= 2,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Kredit Member"
        description="Saldo kredit kelas tiap member. Saldo dihitung dari buku besar; koreksi selalu ditulis sebagai entri baru beserta alasannya."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <Card className="gap-3 py-4">
          <div className="relative px-4">
            <Search className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nama, telepon, atau email"
              aria-label="Cari member"
            />
          </div>
          {term.length === 0 && <p className="px-4 text-xs text-muted-foreground">Aktivitas kredit terbaru</p>}
          {hits.isLoading ? (
            <TableNote>Mencari…</TableNote>
          ) : hits.error ? (
            <TableNote tone="danger">{hits.error.message}</TableNote>
          ) : (hits.data ?? []).length === 0 ? (
            <TableNote>{term.length >= 2 ? "Member tidak ditemukan." : "Ketik minimal 2 huruf untuk mencari."}</TableNote>
          ) : (
            <ul className="flex flex-col">
              {(hits.data ?? []).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(m.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface",
                      selected === m.id && "bg-surface"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{m.name ?? "Tanpa nama"}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{m.phone}</span>
                    </span>
                    <Badge variant={m.balance > 0 ? "ink" : "muted"}>{formatNumber(m.balance)} kr</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selected ? (
          <MemberCreditsPanel customerId={selected} />
        ) : (
          <Card>
            <TableNote>Pilih member untuk melihat saldo kredit, lot, dan riwayatnya.</TableNote>
          </Card>
        )}
      </div>
    </div>
  );
}

function MemberCreditsPanel({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: memberKey(customerId), queryFn: () => gymCreditsApi.memberCredits(customerId) });
  const [dialog, setDialog] = useState<"adjust" | "sell" | null>(null);
  const [reversing, setReversing] = useState<CreditEntry | null>(null);
  const [refunding, setRefunding] = useState<CreditPurchase | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: memberKey(customerId) });
    void queryClient.invalidateQueries({ queryKey: ["gym-credits", "search"] });
  };

  if (detail.isLoading) return <Card><TableNote>Memuat kredit member…</TableNote></Card>;
  if (detail.error || !detail.data) return <Card><TableNote tone="danger">{detail.error?.message ?? "Gagal memuat"}</TableNote></Card>;
  const d = detail.data;
  const liveLots = d.lots.filter((l) => l.remaining > 0 || !l.expired);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{d.member.name ?? "Tanpa nama"}</h2>
          <p className="font-mono text-xs text-muted-foreground">
            {d.member.phone}
            {!d.member.is_active && <Badge variant="destructive" className="ml-2">Nonaktif</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog("adjust")}>
            <SlidersHorizontal /> Sesuaikan
          </Button>
          <Button onClick={() => setDialog("sell")} disabled={!d.member.is_active}>
            <ShoppingCart /> Jual paket
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Saldo kredit"
          value={formatNumber(d.balance)}
          unit="kredit"
          icon={<Ticket />}
          tone={d.low_balance ? "warning" : "ink"}
          hint={d.low_balance ? `Menipis (≤ ${d.low_balance_threshold})` : undefined}
        />
        <StatCard
          label={`Kedaluwarsa ≤ ${d.expiry_reminder_days} hari`}
          value={formatNumber(d.expiring_credits)}
          unit="kredit"
          icon={<CalendarClock />}
          tone={d.expiring_credits > 0 ? "accent" : "default"}
        />
        <StatCard label="Saldo ARK Coin" value={formatRupiah(d.member.ark_balance_idr)} icon={<Coins />} />
      </div>

      <Card className="py-0">
        <h3 className="px-5 pt-4 text-sm font-semibold">Lot kredit</h3>
        {liveLots.length === 0 ? (
          <TableNote>Belum ada lot kredit aktif.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sumber</TableHead>
                <TableHead className="text-right">Sisa</TableHead>
                <TableHead>Kedaluwarsa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liveLots.map((lot) => (
                <TableRow key={lot.id} className={lot.remaining === 0 ? "opacity-60" : undefined}>
                  <TableCell>{lot.package_name ?? "Bonus / penyesuaian"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(lot.remaining)} / {formatNumber(lot.credits)}
                  </TableCell>
                  <TableCell>{lot.expired ? <Badge variant="muted">Kedaluwarsa</Badge> : formatDate(lot.expires_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="py-0">
        <h3 className="px-5 pt-4 text-sm font-semibold">Buku besar</h3>
        {d.entries.length === 0 ? (
          <TableNote>Belum ada mutasi kredit.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mutasi</TableHead>
                <TableHead className="text-right">Kredit</TableHead>
                <TableHead className="hidden md:table-cell">Waktu</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.entries.map((e) => (
                <TableRow key={e.id} className={e.reversed ? "opacity-60" : undefined}>
                  <TableCell className="max-w-[18rem] whitespace-normal">
                    <p className="font-medium">
                      {ENTRY_LABELS[e.type]}
                      {e.reversed && <Badge variant="muted" className="ml-2">Dibatalkan</Badge>}
                    </p>
                    {(e.note || e.created_by_name) && (
                      <p className="text-xs text-muted-foreground">{[e.note, e.created_by_name].filter(Boolean).join(" · ")}</p>
                    )}
                    <p className="text-xs text-muted-foreground md:hidden">{formatDateTime(e.created_at)}</p>
                  </TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", e.amount > 0 ? "text-success" : "text-danger")}>
                    {e.amount > 0 ? "+" : ""}
                    {formatNumber(e.amount)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{formatDateTime(e.created_at)}</TableCell>
                  <TableCell className="text-right">
                    {!e.reversed && e.type !== "reversal" && e.type !== "expiration" && (
                      <Button variant="ghost" size="sm" onClick={() => setReversing(e)}>
                        Batalkan
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {d.passes.length > 0 && (
        <Card className="py-0">
          <h3 className="px-5 pt-4 text-sm font-semibold">Pass</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pass</TableHead>
                <TableHead className="hidden md:table-cell">Periode</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.passes.map((p) => (
                <TableRow key={p.id} className={p.status === "active" ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">{p.package_name}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {formatDate(p.starts_at)} s.d. {formatDate(p.ends_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.status === "active" ? (
                      <Badge variant="success">Aktif · {formatNumber(p.days_left)} hari lagi</Badge>
                    ) : (
                      <Badge variant="muted">{p.status === "refunded" ? "Refund" : "Berakhir"}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="py-0">
        <h3 className="px-5 pt-4 text-sm font-semibold">Pembelian paket</h3>
        {d.purchases.length === 0 ? (
          <TableNote>Belum ada pembelian paket.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paket</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.purchases.map((p) => {
                const badge = PURCHASE_BADGE[p.status];
                return (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[16rem] whitespace-normal">
                      <p className="font-medium">{p.package_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          p.kind === "pass" ? "Pass" : `${formatNumber(p.credits)} kredit`,
                          p.payment_method ? METHOD_LABELS[p.payment_method] : null,
                          p.channel === "member_portal" ? "Portal" : "Front desk",
                          formatDate(p.paid_at ?? p.created_at),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(p.total_idr)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === "paid" && (
                        <Button variant="ghost" size="sm" className="text-danger" onClick={() => setRefunding(p)}>
                          Refund
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {dialog === "adjust" && <AdjustDialog credits={d} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "sell" && <SellDialog credits={d} onClose={() => setDialog(null)} onDone={refresh} />}
      {reversing && (
        <ReasonDialog
          title={`Batalkan ${ENTRY_LABELS[reversing.type].toLowerCase()} ${reversing.amount > 0 ? "+" : ""}${formatNumber(reversing.amount)}?`}
          description="Entri asli tetap ada. Sistem menulis entri pembatalan dengan jumlah berlawanan."
          confirmLabel="Batalkan entri"
          action={(reason) => gymCreditsApi.reverse(reversing.id, reason)}
          onClose={() => setReversing(null)}
          onDone={refresh}
        />
      )}
      {refunding && (
        <ReasonDialog
          title={`Refund ${refunding.package_name}?`}
          description={
            refunding.payment_method === "ark_coin"
              ? `${formatNumber(refunding.credits)} kredit ditarik dan ${formatRupiah(refunding.total_idr)} kembali ke saldo ARK Coin member.`
              : `${formatNumber(refunding.credits)} kredit ditarik. Kembalikan ${formatRupiah(refunding.total_idr)} ke member secara manual di kasir.`
          }
          confirmLabel="Refund"
          action={(reason) => gymCreditsApi.refundPurchase(refunding.id, reason)}
          onClose={() => setRefunding(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

function AdjustDialog({ credits, onClose, onDone }: { credits: MemberCredits; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const value = Number(amount);
  const save = useMutation({
    mutationFn: () => gymCreditsApi.adjust(credits.member.id, value, reason.trim()),
    onSuccess: (res) => {
      toast.success("Kredit disesuaikan", { description: `Saldo sekarang ${formatNumber(res.balanceAfter)} kredit` });
      onDone();
      onClose();
    },
    onError: (error) => toast.error("Penyesuaian gagal", { description: error.message }),
  });
  const valid = Number.isInteger(value) && value !== 0 && reason.trim().length >= 3 && credits.balance + value >= 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Sesuaikan kredit</DialogPanelTitle>
            <DialogPanelDescription>
              Saldo sekarang {formatNumber(credits.balance)} kredit. Angka plus menjadi lot baru dengan masa berlaku default aturan gym.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4">
            <Field label="Jumlah (kredit)" hint="Contoh: 2 untuk menambah, -1 untuk mengurangi.">
              <Input type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label="Alasan" hint="Wajib. Tercatat di buku besar.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kompensasi kelas dibatalkan coach" required />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

function SellDialog({ credits, onClose, onDone }: { credits: MemberCredits; onClose: () => void; onDone: () => void }) {
  const packages = useQuery({ queryKey: ["gym-credits", "packages"], queryFn: gymCreditsApi.packages });
  const [packageId, setPackageId] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [discount, setDiscount] = useState("0");
  const [note, setNote] = useState("");
  const active = (packages.data?.packages ?? []).filter((p) => p.status === "active");
  const pkg = active.find((p) => p.id === packageId);
  const discountIdr = method === "complimentary" ? (pkg?.price_idr ?? 0) : Math.min(Number(discount) || 0, pkg?.price_idr ?? 0);
  const total = (pkg?.price_idr ?? 0) - discountIdr;
  const arkShort = method === "ark_coin" && total > credits.member.ark_balance_idr;

  const sell = useMutation({
    mutationFn: () =>
      gymCreditsApi.sell(credits.member.id, { package_id: packageId, payment_method: method, discount_idr: discountIdr, note }),
    onSuccess: (purchase) => {
      toast.success("Paket terjual", { description: `${purchase.package_name}: +${formatNumber(purchase.credits)} kredit` });
      onDone();
      onClose();
    },
    onError: (error) => toast.error("Penjualan gagal", { description: error.message }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            sell.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Jual paket ke {credits.member.name ?? "member"}</DialogPanelTitle>
            <DialogPanelDescription>Terima pembayaran di kasir dulu. Kredit langsung masuk setelah disimpan.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Paket" className="sm:col-span-2">
              <Select value={packageId} onValueChange={setPackageId}>
                <SelectTrigger aria-label="Paket">
                  <SelectValue placeholder={packages.isLoading ? "Memuat paket…" : "Pilih paket"} />
                </SelectTrigger>
                <SelectContent>
                  {active.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.kind === "pass" ? `Pass ${formatNumber(p.validity_days)} hari` : `${formatNumber(p.credits)} kredit`} ·{" "}
                      {formatRupiah(p.price_idr)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Metode bayar">
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger aria-label="Metode bayar">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Diskon (Rp)">
              <Input
                type="number"
                min={0}
                value={method === "complimentary" ? String(discountIdr) : discount}
                disabled={method === "complimentary"}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Field label="Catatan" className="sm:col-span-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="No. struk EDC, nama kasir, dll." />
            </Field>
            <div className="rounded-2xl bg-surface px-4 py-3 sm:col-span-2">
              <p className="text-xs text-muted-foreground">Total dibayar</p>
              <p className="text-2xl font-bold tabular-nums">{formatRupiah(total)}</p>
              {method === "ark_coin" && (
                <p className={cn("text-xs", arkShort ? "text-danger" : "text-muted-foreground")}>
                  Saldo ARK Coin {formatRupiah(credits.member.ark_balance_idr)}
                  {arkShort ? " · tidak cukup" : ""}
                </p>
              )}
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!pkg || arkShort || sell.isPending}>
              {sell.isPending ? "Menyimpan…" : "Simpan penjualan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

function ReasonDialog({
  title,
  description,
  confirmLabel,
  action,
  onClose,
  onDone,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  action: (reason: string) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const run = useMutation({
    mutationFn: () => action(reason.trim()),
    onSuccess: () => {
      toast.success(`${confirmLabel} berhasil`);
      onDone();
      onClose();
    },
    onError: (error) => toast.error(`${confirmLabel} gagal`, { description: error.message }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{title}</DialogPanelTitle>
            <DialogPanelDescription>{description}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            <Field label="Alasan" hint="Wajib. Tercatat di buku besar.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={reason.trim().length < 3 || run.isPending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
