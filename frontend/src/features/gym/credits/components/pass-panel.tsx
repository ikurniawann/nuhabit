"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import { gymCreditsApi, type CreditPurchase, type MemberCredits, type MemberPass, type RefundMode, type RenewWith } from "../api";

const RENEW_LABELS: Record<RenewWith, string> = { ark: "ARK Coin", invoice: "Invoice online" };

const isLive = (p: MemberPass) => p.status === "active" || p.status === "frozen";

function PassStatus({ pass }: { pass: MemberPass }) {
  if (pass.status === "frozen") return <Badge variant="warning">Dibekukan s.d. {formatDate(pass.frozen_until ?? pass.ends_at)}</Badge>;
  if (pass.status === "active" && pass.upcoming) return <Badge variant="info">Antre · mulai {formatDate(pass.starts_at)}</Badge>;
  if (pass.status === "active") return <Badge variant="success">Aktif · {formatNumber(pass.days_left)} hari lagi</Badge>;
  return <Badge variant="muted">{pass.status === "refunded" ? "Refund" : "Berakhir"}</Badge>;
}

/** Pass member: status, bekukan/aktifkan, perpanjang, dan perpanjangan otomatis. */
export function PassesCard({ credits, onDone }: { credits: MemberCredits; onDone: () => void }) {
  const [dialog, setDialog] = useState<{ kind: "freeze" | "extend"; pass: MemberPass } | null>(null);
  const { freeze } = credits;
  const canFreeze = freeze.max_days_per_year > 0 && freeze.remaining_days >= freeze.min_days;
  const change = useMutation({
    mutationFn: (job: { run: () => Promise<MemberPass>; done: string }) => job.run(),
    onSuccess: (_pass, job) => {
      toast.success(job.done);
      onDone();
    },
    onError: (error) => toast.error("Pass gagal diubah", { description: error.message }),
  });

  return (
    <Card className="py-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
        <h3 className="text-sm font-semibold">Pass</h3>
        {freeze.max_days_per_year > 0 && (
          <p className="text-xs text-muted-foreground">
            Jatah bekukan tersisa {formatNumber(freeze.remaining_days)} dari {formatNumber(freeze.max_days_per_year)} hari
          </p>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pass</TableHead>
            <TableHead className="hidden md:table-cell">Periode</TableHead>
            <TableHead>Perpanjang otomatis</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {credits.passes.map((p) => (
            <TableRow key={p.id} className={isLive(p) ? undefined : "opacity-60"}>
              <TableCell className="max-w-[16rem] whitespace-normal">
                <p className="font-medium">{p.package_name}</p>
                <PassStatus pass={p} />
                <p className="text-xs text-muted-foreground md:hidden">
                  {formatDate(p.starts_at)} s.d. {formatDate(p.ends_at)}
                </p>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {formatDate(p.starts_at)} s.d. {formatDate(p.ends_at)}
              </TableCell>
              <TableCell>
                {isLive(p) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Switch
                      checked={p.auto_renew}
                      disabled={change.isPending}
                      aria-label={`Perpanjang otomatis ${p.package_name}`}
                      onCheckedChange={(on) =>
                        change.mutate({
                          run: () => gymCreditsApi.setAutoRenew(p.id, on),
                          done: on ? "Perpanjangan otomatis aktif" : "Perpanjangan otomatis dimatikan",
                        })
                      }
                    />
                    {p.auto_renew && (
                      <Select
                        value={p.renew_with}
                        onValueChange={(v) =>
                          change.mutate({
                            run: () => gymCreditsApi.setAutoRenew(p.id, true, v as RenewWith),
                            done: `Perpanjangan dibayar dengan ${RENEW_LABELS[v as RenewWith]}`,
                          })
                        }
                      >
                        <SelectTrigger aria-label="Cara bayar perpanjangan" className="h-8 min-w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(RENEW_LABELS) as RenewWith[]).map((w) => (
                            <SelectItem key={w} value={w}>
                              {RENEW_LABELS[w]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {isLive(p) && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {p.status === "frozen" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={change.isPending}
                        onClick={() => change.mutate({ run: () => gymCreditsApi.unfreezePass(p.id), done: "Pass aktif lagi" })}
                      >
                        Aktifkan
                      </Button>
                    ) : (
                      !p.upcoming && (
                        <Button variant="ghost" size="sm" disabled={!canFreeze} onClick={() => setDialog({ kind: "freeze", pass: p })}>
                          Bekukan
                        </Button>
                      )
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "extend", pass: p })}>
                      Perpanjang
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {dialog?.kind === "freeze" && (
        <DaysDialog
          title={`Bekukan ${dialog.pass.package_name}`}
          description={`Selama dibekukan, pass tidak bisa dipakai booking atau masuk gate. Masa berlaku bertambah sebanyak hari yang dibekukan. Minimal ${formatNumber(freeze.min_days)} hari, sisa jatah ${formatNumber(freeze.remaining_days)} hari.`}
          min={freeze.min_days}
          max={freeze.remaining_days}
          confirmLabel="Bekukan"
          action={(days) => gymCreditsApi.freezePass(dialog.pass.id, days)}
          onClose={() => setDialog(null)}
          onDone={onDone}
        />
      )}
      {dialog?.kind === "extend" && (
        <DaysDialog
          title={`Perpanjang ${dialog.pass.package_name}`}
          description={`Berakhir ${formatDate(dialog.pass.ends_at)}. Pass yang antre setelahnya ikut bergeser.`}
          min={1}
          max={365}
          withReason
          confirmLabel="Perpanjang"
          action={(days, reason) => gymCreditsApi.extendPass(dialog.pass.id, days, reason)}
          onClose={() => setDialog(null)}
          onDone={onDone}
        />
      )}
    </Card>
  );
}

function DaysDialog({
  title,
  description,
  min,
  max,
  withReason = false,
  confirmLabel,
  action,
  onClose,
  onDone,
}: {
  title: string;
  description: string;
  min: number;
  max: number;
  withReason?: boolean;
  confirmLabel: string;
  action: (days: number, reason: string) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [days, setDays] = useState(String(min));
  const [reason, setReason] = useState("");
  const value = Number(days);
  const run = useMutation({
    mutationFn: () => action(value, reason.trim()),
    onSuccess: () => {
      toast.success(`${confirmLabel} berhasil`);
      onDone();
      onClose();
    },
    onError: (error) => toast.error(`${confirmLabel} gagal`, { description: error.message }),
  });
  const valid = Number.isInteger(value) && value >= min && value <= max && (!withReason || reason.trim().length >= 3);

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
          <DialogPanelBody className="grid grid-cols-1 gap-4">
            <Field label="Jumlah hari">
              <Input type="number" step={1} min={min} max={max} value={days} onChange={(e) => setDays(e.target.value)} required />
            </Field>
            {withReason && (
              <Field label="Alasan" hint="Wajib. Tercatat di riwayat pass.">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kompensasi gym tutup renovasi" required />
              </Field>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || run.isPending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

/**
 * Refund pembelian: pass dihitung prorata dari hari yang belum dipakai,
 * dengan opsi refund penuh; paket kredit selalu penuh dan kreditnya ditarik.
 */
export function RefundDialog({ purchase, onClose, onDone }: { purchase: CreditPurchase; onClose: () => void; onDone: () => void }) {
  const quote = useQuery({
    queryKey: ["gym-credits", "refund-quote", purchase.id],
    queryFn: () => gymCreditsApi.refundQuote(purchase.id),
  });
  const [mode, setMode] = useState<RefundMode>("prorated");
  const [reason, setReason] = useState("");
  const isPass = purchase.kind === "pass";
  const q = quote.data;
  const amount = q ? (isPass && mode === "full" ? q.full_idr : q.prorated_idr) : 0;
  const run = useMutation({
    mutationFn: () => gymCreditsApi.refundPurchase(purchase.id, reason.trim(), isPass ? mode : "full"),
    onSuccess: (res) => {
      toast.success("Refund berhasil", { description: `${formatRupiah(res.refunded_idr ?? amount)} dikembalikan` });
      onDone();
      onClose();
    },
    onError: (error) => toast.error("Refund gagal", { description: error.message }),
  });
  const payBack =
    purchase.payment_method === "ark_coin"
      ? `${formatRupiah(amount)} kembali ke saldo ARK Coin member.`
      : `Kembalikan ${formatRupiah(amount)} ke member secara manual di kasir.`;

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
            <DialogPanelTitle>Refund {purchase.package_name}?</DialogPanelTitle>
            <DialogPanelDescription>
              {isPass
                ? "Pass dihentikan dan pass yang antre setelahnya dimajukan."
                : q
                  ? `${formatNumber(q.unused_credits)} dari ${formatNumber(purchase.credits)} kredit belum terpakai dan ditarik. Refund dihitung dari kredit sisa itu.`
                  : "Kredit yang belum terpakai dari pembelian ini ditarik."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4">
            {quote.isLoading ? (
              <TableNote>Menghitung refund…</TableNote>
            ) : quote.error || !q ? (
              <TableNote tone="danger">{quote.error?.message ?? "Gagal menghitung refund"}</TableNote>
            ) : (
              <>
                {isPass && (
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-medium text-foreground">Jumlah refund</legend>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant={mode === "prorated" ? "ink" : "outline"} aria-pressed={mode === "prorated"} onClick={() => setMode("prorated")}>
                        Prorata · {formatRupiah(q.prorated_idr)}
                      </Button>
                      <Button type="button" size="sm" variant={mode === "full" ? "ink" : "outline"} aria-pressed={mode === "full"} onClick={() => setMode("full")}>
                        Penuh · {formatRupiah(q.full_idr)}
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {mode === "prorated"
                        ? `${formatNumber(q.unused_days)} dari ${formatNumber(q.total_days)} hari belum dipakai.`
                        : "Refund penuh untuk salah input atau kebijakan khusus."}
                    </p>
                  </fieldset>
                )}
                <div className="rounded-2xl bg-surface px-4 py-3">
                  <p className="text-xs text-muted-foreground">Dikembalikan</p>
                  <p className="text-2xl font-bold tabular-nums">{formatRupiah(amount)}</p>
                  <p className="text-xs text-muted-foreground">{payBack}</p>
                </div>
              </>
            )}
            <Field label="Alasan" hint="Wajib. Tercatat di buku besar.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={!q || reason.trim().length < 3 || run.isPending}>
              Refund
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
