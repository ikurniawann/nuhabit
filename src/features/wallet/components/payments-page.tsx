"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { ENTRY_LABELS, STATUS_LABELS, entryDelta, signedRupiah, walletApi, type OnlinePayment, type PaymentFilters } from "../api";

const PAYMENTS_KEY = ["wallet", "payments"];
const ALL = "all";

const RECONCILE_MESSAGES: Record<string, string> = {
  credited: "Pembayaran ditemukan di Xendit dan saldo sudah dikredit.",
  already_completed: "Pembayaran ini sudah lunas.",
  pending: "Belum ada pembayaran berhasil di Xendit.",
  not_qris: "Transaksi ini tidak menunggu pembayaran QRIS.",
  error: "Xendit tidak bisa dihubungi.",
};

/** POS → Member → Pembayaran Online: top-up QRIS Xendit dari kasir dan portal. */
export function PaymentsPage() {
  const [filters, setFilters] = useState<PaymentFilters>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const payments = useQuery({ queryKey: [...PAYMENTS_KEY, filters], queryFn: () => walletApi.payments(filters) });

  const setFilter = (key: keyof PaymentFilters) => (value: string) =>
    setFilters((cur) => ({ ...cur, [key]: value === ALL ? undefined : value }));
  const summary = (status: string) => payments.data?.summary.find((s) => s.status === status);
  const paid = summary("completed");
  const pending = summary("pending");

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="POS · Member"
        title="Pembayaran Online"
        description="Semua top-up QRIS Xendit, dari kasir maupun portal member. Cek ulang ke Xendit bila pembayaran pending terlalu lama."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Lunas" value={formatRupiah(paid?.amount ?? 0)} unit={`${formatNumber(paid?.count ?? 0)} trx`} icon={<CheckCircle2 />} tone="success" />
        <StatCard
          label="Menunggu bayar"
          value={formatNumber(pending?.count ?? 0)}
          unit="trx"
          icon={<Clock />}
          tone={pending?.count ? "warning" : "default"}
        />
        <StatCard
          label="Total transaksi"
          value={formatNumber((payments.data?.summary ?? []).reduce((s, r) => s + r.count, 0))}
          icon={<QrCode />}
          tone="ink"
        />
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Input
          className="w-full sm:w-64"
          placeholder="Cari member, HP, atau ID Xendit"
          value={filters.q ?? ""}
          onChange={(e) => setFilters((cur) => ({ ...cur, q: e.target.value || undefined }))}
        />
        <Select value={filters.status ?? ALL} onValueChange={setFilter("status")}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, { label }]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.source ?? ALL} onValueChange={setFilter("source")}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua sumber</SelectItem>
            <SelectItem value="cashier">Kasir</SelectItem>
            <SelectItem value="member">Portal member</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" className="w-40" value={filters.from ?? ""} onChange={(e) => setFilter("from")(e.target.value || ALL)} />
        <Input type="date" className="w-40" value={filters.to ?? ""} onChange={(e) => setFilter("to")(e.target.value || ALL)} />
      </Card>

      <Card className="py-0">
        {payments.isLoading ? (
          <TableNote>Memuat pembayaran…</TableNote>
        ) : payments.error ? (
          <TableNote tone="danger">{payments.error.message}</TableNote>
        ) : (payments.data?.payments ?? []).length === 0 ? (
          <TableNote>Tidak ada pembayaran untuk filter ini.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="text-right">Nominal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Dibuat / dibayar</TableHead>
                <TableHead className="hidden lg:table-cell">Xendit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.data?.payments.map((p) => (
                <PaymentRow key={p.id} payment={p} onOpen={() => setOpenId(p.id)} />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {openId && <PaymentDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function PaymentRow({ payment: p, onOpen }: { payment: OnlinePayment; onOpen: () => void }) {
  const status = STATUS_LABELS[p.status] ?? { label: p.status, variant: "muted" as const };
  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell>
        <p className="font-medium">{p.member_name ?? "Member"}</p>
        <p className="text-xs text-muted-foreground">
          {[p.member_phone, p.source === "member" ? "Portal" : "Kasir", p.package_name].filter(Boolean).join(" · ")}
        </p>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatRupiah(p.amount)}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <Badge variant={status.variant}>{status.label}</Badge>
          {p.refunded_at && <Badge variant="outline">Direfund</Badge>}
          {p.simulated && <Badge variant="info">Simulasi</Badge>}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {formatDateTime(p.created_at)}
        <span className="block text-xs text-muted-foreground">{p.paid_at ? `Dibayar ${formatDateTime(p.paid_at)}` : "Belum dibayar"}</span>
      </TableCell>
      <TableCell className="hidden max-w-[12rem] truncate font-mono text-xs lg:table-cell">
        {p.xendit_transaction_id ?? p.reference_id ?? "—"}
      </TableCell>
    </TableRow>
  );
}

function PaymentDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const key = [...PAYMENTS_KEY, "detail", id];
  const detail = useQuery({ queryKey: key, queryFn: () => walletApi.payment(id) });
  const reconcile = useMutation({
    mutationFn: () => walletApi.reconcile(id),
    onSuccess: (outcome) => {
      const message = RECONCILE_MESSAGES[outcome.status] ?? outcome.status;
      if (outcome.status === "credited") toast.success(message);
      else toast.message(message, { description: outcome.detail });
      void queryClient.invalidateQueries({ queryKey: PAYMENTS_KEY });
    },
    onError: (error) => toast.error("Rekonsiliasi gagal", { description: error.message }),
  });

  const p = detail.data?.payment;
  const meta = p?.metadata ?? {};
  const rows: [string, React.ReactNode][] = p
    ? [
        ["Status", STATUS_LABELS[p.status ?? ""]?.label ?? p.status],
        ["Nominal dibayar", formatRupiah(p.amount)],
        ["Paket", (meta.package_name as string) ?? "Nominal bebas"],
        ["Sumber", meta.source === "member" ? "Portal member" : "Kasir"],
        ["Dibuat", formatDateTime(p.created_at)],
        ["Dibayar", formatDateTime((meta.credited_at as string) ?? null)],
        ["QR Xendit", p.xendit_transaction_id ?? "—"],
        ["Payment Xendit", (meta.xendit_payment_id as string) ?? "—"],
        ["Referensi", p.reference_id ?? "—"],
        ["Lingkungan", (meta.environment as string) ?? "—"],
      ]
    : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>Detail pembayaran</DialogPanelTitle>
          <DialogPanelDescription>
            {detail.data?.member ? (
              <Link className="underline" href={`/dashboard/pos/wallet?member=${detail.data.member.id}`}>
                {detail.data.member.name ?? detail.data.member.phone} · saldo {formatRupiah(detail.data.member.balance)}
              </Link>
            ) : (
              "Memuat…"
            )}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {detail.isLoading && <TableNote>Memuat…</TableNote>}
          {detail.error && <TableNote tone="danger">{detail.error.message}</TableNote>}
          {p && (
            <>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {rows.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-border/60 py-1.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="truncate text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              {(detail.data?.related ?? []).length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-semibold">Entri terkait</p>
                  <ul className="space-y-1 text-sm">
                    {detail.data?.related.map((r) => (
                      <li key={r.id} className="flex justify-between gap-3">
                        <span>
                          {ENTRY_LABELS[r.type] ?? r.type} · {formatDateTime(r.created_at)}
                        </span>
                        <span className="tabular-nums">
                          {signedRupiah(entryDelta(r))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {p.status === "pending" && (
                <Button variant="soft" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
                  <RefreshCw /> Cek ke Xendit
                </Button>
              )}
            </>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
