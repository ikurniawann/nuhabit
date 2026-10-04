"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime, formatRupiah } from "@/lib/format";
import {
  useMarkBandLost,
  useSettleVisit,
  useTopupVisit,
  useVisitDetail,
  useVoidCharge,
} from "../queries";
import {
  CASH_METHOD_LABELS,
  type CashMethod,
  type VisitBand,
  type VisitCharge,
} from "../types";

interface VisitDetailDialogProps {
  visitId: string | null;
  onOpenChange: (open: boolean) => void;
  /** true bila user boleh void (supervisor) — server tetap menolak kasir. */
  canVoidCharges?: boolean;
}

function MethodSelect({
  value,
  onChange,
}: {
  value: CashMethod;
  onChange: (m: CashMethod) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as CashMethod)}>
      <SelectTrigger className="h-9 w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(CASH_METHOD_LABELS).map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function VisitDetailDialog({
  visitId,
  onOpenChange,
  canVoidCharges = false,
}: VisitDetailDialogProps) {
  const detailQuery = useVisitDetail(visitId);
  const detail = detailQuery.data;

  const [payMethod, setPayMethod] = useState<CashMethod>("cash");
  const [refundMethod, setRefundMethod] = useState<CashMethod>("cash");
  const [topupAmount, setTopupAmount] = useState("");
  const [topupMethod, setTopupMethod] = useState<CashMethod>("cash");
  const [settlingBand, setSettlingBand] = useState<VisitBand | null>(null);
  const [losingBand, setLosingBand] = useState<VisitBand | null>(null);
  const [voidingCharge, setVoidingCharge] = useState<VisitCharge | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const settleMutation = useSettleVisit(() => setSettlingBand(null));
  const lostMutation = useMarkBandLost(() => setLosingBand(null));
  const topupMutation = useTopupVisit(() => setTopupAmount(""));
  const voidMutation = useVoidCharge(() => {
    setVoidingCharge(null);
    setVoidReason("");
  });

  // Tagihan bersih per gelang (settle per gelang, postpaid)
  const bandDue = useMemo(() => {
    const dues = new Map<string, number>();
    if (!detail) return dues;
    for (const c of detail.charges) {
      if (!c.band_id) continue;
      const delta = c.direction === "debit" ? c.amount : -c.amount;
      dues.set(c.band_id, Math.round(((dues.get(c.band_id) ?? 0) + delta) * 100) / 100);
    }
    return dues;
  }, [detail]);

  if (visitId === null) return null;

  const isOpen = detail?.visit.status === "open";
  const isPrepaid = detail?.visit.payment_mode === "prepaid";
  const activeBands = detail?.bands.filter((b) => b.status === "aktif") ?? [];
  // Baris yang sudah dibalik: id-nya muncul di voided_by_charge_id baris lain
  const reversedChargeIds = new Set(
    (detail?.charges ?? [])
      .map((c) => c.voided_by_charge_id)
      .filter((id): id is string => id !== null)
  );

  const handleSettleAll = () => {
    if (!detail || settleMutation.isPending) return;
    settleMutation.mutate({
      id: detail.visit.id,
      values: {
        payments:
          detail.plan.amountDue > 0
            ? [{ method: payMethod, amount: detail.plan.amountDue }]
            : [],
        refund_method: detail.plan.refundAmount > 0 ? refundMethod : undefined,
      },
    });
  };

  const handleSettleBand = () => {
    if (!detail || !settlingBand || settleMutation.isPending) return;
    const due = bandDue.get(settlingBand.band_id) ?? 0;
    settleMutation.mutate({
      id: detail.visit.id,
      values: {
        visit_band_id: settlingBand.id,
        payments: due > 0 ? [{ method: payMethod, amount: due }] : [],
      },
    });
  };

  const handleTopup = () => {
    if (!detail || topupMutation.isPending) return;
    const amount = Number(topupAmount) || 0;
    if (amount <= 0) return;
    topupMutation.mutate({
      id: detail.visit.id,
      values: { amount, method: topupMethod },
    });
  };

  return (
    <Dialog open={visitId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {detail
              ? `${detail.visit.contact_name} — ${detail.visit.payment_mode === "prepaid" ? "Prepaid" : "Postpaid"}`
              : "Rincian Kunjungan"}
          </DialogTitle>
        </DialogHeader>

        {detailQuery.isLoading || !detail ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat rincian...</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <Badge
                className={`border-0 font-normal ${
                  detail.visit.status === "open"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {detail.visit.status === "open" ? "Berjalan" : "Selesai"}
              </Badge>
              <span>Masuk {formatDateTime(detail.visit.opened_at)}</span>
              {detail.visit.contact_phone ? (
                <span>· {detail.visit.contact_phone}</span>
              ) : null}
              {detail.visit.credit_limit !== null ? (
                <span>· Plafon {formatRupiah(detail.visit.credit_limit)}</span>
              ) : null}
            </div>

            {/* Ringkasan tagihan */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-gray-200/70 px-3 py-2.5">
                <p className="text-xs text-gray-500">Total Tagihan</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatRupiah(detail.summary.debit)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200/70 px-3 py-2.5">
                <p className="text-xs text-gray-500">Uang Masuk</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatRupiah(detail.summary.kredit)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200/70 px-3 py-2.5">
                <p className="text-xs text-gray-500">
                  {isPrepaid ? "Saldo" : "Sisa Tagihan"}
                </p>
                <p
                  className={`text-lg font-semibold ${
                    (isPrepaid ? detail.summary.saldo : detail.summary.outstanding) < 0
                      ? "text-red-600"
                      : "text-gray-900"
                  }`}
                >
                  {formatRupiah(isPrepaid ? detail.summary.saldo : detail.summary.outstanding)}
                </p>
              </div>
            </div>

            {/* Gelang */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">
                Gelang ({detail.bands.length})
              </h3>
              <div className="space-y-2">
                {detail.bands.map((band) => (
                  <div
                    key={band.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200/70 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-gray-600">
                      {band.nfc_uid}
                    </span>
                    {band.guest_name ? (
                      <span className="text-xs font-medium text-gray-800">
                        {band.guest_name}
                      </span>
                    ) : null}
                    <Badge className="border-0 bg-blue-100 font-normal text-blue-700">
                      {band.ticket_type_name}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {band.entered_at
                        ? `Masuk ${formatDateTime(band.entered_at)}`
                        : "Belum tap gate"}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {band.status !== "aktif" ? (
                        <Badge
                          className={`border-0 font-normal ${
                            band.status === "hilang"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {band.status}
                        </Badge>
                      ) : null}
                      {isOpen && !isPrepaid && band.status === "aktif" &&
                      activeBands.length > 1 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => setSettlingBand(band)}
                        >
                          Settle {formatRupiah(bandDue.get(band.band_id) ?? 0)}
                        </Button>
                      ) : null}
                      {isOpen && band.status === "aktif" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => setLosingBand(band)}
                        >
                          Hilang
                        </Button>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Ledger */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">
                Rincian Tagihan
              </h3>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200/70">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-200/50">
                    {detail.charges.map((charge) => {
                      const isReversed = reversedChargeIds.has(charge.id);
                      const canVoid =
                        canVoidCharges &&
                        isOpen &&
                        charge.direction === "debit" &&
                        charge.charge_type !== "refund-deposit" &&
                        !isReversed;
                      return (
                        <tr key={charge.id}>
                          <td className="px-3 py-2 text-gray-700">
                            <span className={isReversed ? "line-through opacity-60" : ""}>
                              {charge.description}
                            </span>
                            <span className="ml-1 text-xs text-gray-400">
                              {formatDateTime(charge.created_at)}
                            </span>
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-medium ${
                              charge.direction === "kredit"
                                ? "text-emerald-600"
                                : "text-gray-900"
                            } ${isReversed ? "line-through opacity-60" : ""}`}
                          >
                            {charge.direction === "kredit" ? "−" : ""}
                            {formatRupiah(charge.amount)}
                          </td>
                          <td className="w-14 px-2 py-2 text-right">
                            {canVoid ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
                                onClick={() => {
                                  setVoidingCharge(charge);
                                  setVoidReason("");
                                }}
                              >
                                Void
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {detail.charges.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-xs text-gray-400">
                          Belum ada transaksi
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Konfirmasi gelang hilang — keputusan owner: TANPA denda,
                tagihan tetap ditagih by data saat settlement */}
            {losingBand ? (
              <div className="rounded-lg border-2 border-red-200 bg-red-50/50 p-4">
                <p className="text-sm text-gray-700">
                  Tandai gelang{" "}
                  <span className="font-mono text-xs">{losingBand.nfc_uid}</span>{" "}
                  hilang? Tanpa denda — tagihannya tetap tertagih saat
                  settlement rombongan (cari kunjungan via nama / no. WA).
                  Gelang langsung diblokir di gate & kasir dan tidak bisa
                  dibatalkan; bila ketemu lagi, aktifkan ulang dari registry
                  gelang setelah settlement.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={lostMutation.isPending}
                    onClick={() =>
                      lostMutation.mutate({
                        visitId: detail.visit.id,
                        visitBandId: losingBand.id,
                      })
                    }
                  >
                    {lostMutation.isPending ? "Memproses…" : "Ya, Gelang Hilang"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLosingBand(null)}
                  >
                    Batal
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Konfirmasi void tagihan (wewenang supervisor — server menolak kasir) */}
            {voidingCharge ? (
              <div className="rounded-lg border-2 border-red-200 bg-red-50/50 p-4">
                <p className="text-sm text-gray-700">
                  Void <strong>{voidingCharge.description}</strong> (
                  {formatRupiah(voidingCharge.amount)})? Baris pembalik akan ditulis —
                  ledger tidak pernah dihapus.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Alasan void (wajib)"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    className="h-9 w-64"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={voidReason.trim().length < 3 || voidMutation.isPending}
                    onClick={() =>
                      voidMutation.mutate({
                        visitId: detail.visit.id,
                        chargeId: voidingCharge.id,
                        reason: voidReason.trim(),
                      })
                    }
                  >
                    {voidMutation.isPending ? "Memproses…" : "Void Tagihan"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setVoidingCharge(null)}
                  >
                    Batal
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Top-up (prepaid, open) */}
            {isOpen && isPrepaid ? (
              <div className="rounded-lg border border-gray-200/70 p-3">
                <Label className="text-sm font-semibold">Top-up Saldo</Label>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={50000}
                    placeholder="Nominal"
                    value={topupAmount}
                    onChange={(e) => setTopupAmount(e.target.value)}
                    className="h-9 w-36"
                  />
                  <MethodSelect value={topupMethod} onChange={setTopupMethod} />
                  <Button
                    size="sm"
                    onClick={handleTopup}
                    disabled={topupMutation.isPending || (Number(topupAmount) || 0) <= 0}
                  >
                    {topupMutation.isPending ? "Menyimpan…" : "Top-up"}
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Settlement rombongan */}
            {isOpen ? (
              <div className="rounded-lg border-2 border-pink-200 bg-pink-50/50 p-4">
                <h3 className="text-sm font-semibold text-gray-900">
                  Settlement Rombongan
                </h3>
                <div className="mt-2 space-y-2 text-sm text-gray-700">
                  {detail.plan.amountDue > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        Harus dibayar:{" "}
                        <strong>{formatRupiah(detail.plan.amountDue)}</strong> via
                      </span>
                      <MethodSelect value={payMethod} onChange={setPayMethod} />
                    </div>
                  ) : null}
                  {detail.plan.refundAmount > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        Refund sisa saldo:{" "}
                        <strong>{formatRupiah(detail.plan.refundAmount)}</strong> via
                      </span>
                      <MethodSelect value={refundMethod} onChange={setRefundMethod} />
                    </div>
                  ) : null}
                  {detail.plan.amountDue === 0 && detail.plan.refundAmount === 0 ? (
                    <p>Ledger seimbang — tinggal tutup kunjungan.</p>
                  ) : null}
                </div>
                <Button
                  className="mt-3 w-full"
                  onClick={handleSettleAll}
                  disabled={settleMutation.isPending}
                >
                  {settleMutation.isPending
                    ? "Memproses…"
                    : `Tutup Kunjungan (${detail.bands.filter((b) => b.status === "aktif").length} gelang)`}
                </Button>
                <p className="mt-2 text-xs text-gray-500">
                  Semua gelang dilepas & kembali tersedia; kunjungan tidak bisa
                  menerima charge baru.
                </p>
              </div>
            ) : null}

            {/* Konfirmasi settle per gelang */}
            {settlingBand ? (
              <div className="rounded-lg border-2 border-blue-200 bg-blue-50/50 p-4">
                <p className="text-sm text-gray-700">
                  Settle gelang{" "}
                  <span className="font-mono text-xs">{settlingBand.nfc_uid}</span> —
                  tagihan <strong>{formatRupiah(bandDue.get(settlingBand.band_id) ?? 0)}</strong>
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <MethodSelect value={payMethod} onChange={setPayMethod} />
                  <Button
                    size="sm"
                    onClick={handleSettleBand}
                    disabled={settleMutation.isPending}
                  >
                    {settleMutation.isPending ? "Memproses…" : "Bayar & Lepas Gelang"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSettlingBand(null)}
                  >
                    Batal
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
