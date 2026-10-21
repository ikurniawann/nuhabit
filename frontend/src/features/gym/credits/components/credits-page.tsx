"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, CalendarClock, Coins, Search, ShoppingCart, SlidersHorizontal, Ticket } from "lucide-react";
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
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { MemberLink } from "@/features/gym/members/member-link";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import {
  ENTRY_LABELS,
  gymCreditsApi,
  isReversible,
  METHOD_LABELS,
  PURCHASE_BADGE,
  type CreditEntry,
  type CreditPurchase,
  type MemberCredits,
} from "../api";
import { Can } from "@/components/iam/can";
import { useCan } from "@/components/iam/iam-access-provider";
import { defaultBranchId, useGymBranches } from "@/features/gym/branches";
import { DeskShiftBar } from "./desk-shift";
import { PassesCard, RefundDialog } from "./pass-panel";
import { ReceiptButton } from "./receipt-button";
import { SellDialog } from "./sell-dialog";
import { TransferDialog } from "./transfer-dialog";
import { useDebounced } from "@/features/gym/use-debounced";

const memberKey = (id: string) => ["gym-credits", "member", id];

/** Gym → Kredit Member: cari member, lihat saldo & lot, koreksi, jual paket di front desk. */
export function CreditsPage() {
  const [q, setQ] = useState("");
  // ?member=<id> keeps the open member in the URL, so the member page can link here.
  const router = useRouter();
  const pathname = usePathname();
  const selected = useSearchParams().get("member");
  const setSelected = (id: string) => router.replace(`${pathname}?member=${id}`, { scroll: false });
  const term = useDebounced(q.trim());
  const hits = useQuery({
    queryKey: ["gym-credits", "search", term],
    queryFn: () => gymCreditsApi.searchMembers(term),
    enabled: term.length === 0 || term.length >= 2,
  });
  // Only sellers run a till shift here; the shift serves the staff branch.
  const canSell = useCan("gym.credits", "create");
  const branches = useGymBranches();

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Kredit Member"
        description="Saldo kredit kelas tiap member. Saldo dihitung dari buku besar; koreksi selalu ditulis sebagai entri baru beserta alasannya."
      />
      {canSell && branches.isSuccess && <DeskShiftBar branchId={defaultBranchId(branches.data) || null} />}

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
  const canCorrect = useCan("gym.credits", "update");
  const detail = useQuery({ queryKey: memberKey(customerId), queryFn: () => gymCreditsApi.memberCredits(customerId) });
  const [dialog, setDialog] = useState<"adjust" | "sell" | "transfer" | null>(null);
  const [reversing, setReversing] = useState<CreditEntry | null>(null);
  const [refunding, setRefunding] = useState<CreditPurchase | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: memberKey(customerId) });
    void queryClient.invalidateQueries({ queryKey: ["gym-credits", "search"] });
    void queryClient.invalidateQueries({ queryKey: ["gym-credits", "shift"] });
  };

  if (detail.isLoading) return <Card><TableNote>Memuat kredit member…</TableNote></Card>;
  if (detail.error || !detail.data) return <Card><TableNote tone="danger">{detail.error?.message ?? "Gagal memuat"}</TableNote></Card>;
  const d = detail.data;
  const liveLots = d.lots.filter((l) => l.remaining > 0 || !l.expired);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            <MemberLink id={d.member.id} name={d.member.name ?? "Tanpa nama"} className="font-semibold" />
          </h2>
          <p className="font-mono text-xs text-muted-foreground">
            {d.member.phone}
            {!d.member.is_active && <Badge variant="destructive" className="ml-2">Nonaktif</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Can menu="gym.credits" action="update" mode="disable">
            <Button variant="outline" onClick={() => setDialog("adjust")}>
              <SlidersHorizontal /> Sesuaikan
            </Button>
          </Can>
          <Can menu="gym.credits" action="update" mode="disable">
            <Button variant="outline" onClick={() => setDialog("transfer")} disabled={d.balance <= 0}>
              <ArrowLeftRight /> Transfer kredit
            </Button>
          </Can>
          <Can menu="gym.credits" action="create" mode="disable">
            <Button onClick={() => setDialog("sell")} disabled={!d.member.is_active}>
              <ShoppingCart /> Jual paket
            </Button>
          </Can>
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
                    {canCorrect && isReversible(e) && (
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

      {d.passes.length > 0 && <PassesCard credits={d} onDone={refresh} />}

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
                          p.receipt_number,
                          p.refunded_idr != null ? `Refund ${formatRupiah(p.refunded_idr)}` : null,
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
                      <div className="flex flex-wrap justify-end gap-1">
                        <ReceiptButton purchase={p} />
                        {canCorrect && p.status === "paid" && (
                          <Button variant="ghost" size="sm" className="text-danger" onClick={() => setRefunding(p)}>
                            Refund
                          </Button>
                        )}
                      </div>
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
      {dialog === "transfer" && (
        <TransferDialog
          credits={d}
          onClose={() => setDialog(null)}
          // The receiver's balance changes too.
          onDone={() => void queryClient.invalidateQueries({ queryKey: ["gym-credits"] })}
        />
      )}
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
      {refunding && <RefundDialog purchase={refunding} onClose={() => setRefunding(null)} onDone={refresh} />}
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
