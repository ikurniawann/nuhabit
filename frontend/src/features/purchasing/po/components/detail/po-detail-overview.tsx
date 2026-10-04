"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Banknote, Boxes, Calendar, CreditCard, Factory, FileText, MapPin, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import {
  orderProgressDetail,
  poFinancialBreakdown,
  type PODetailFigures,
} from "@/lib/purchasing/po-ui-detail";
import { poLifecycleBadge, poStatusBadge } from "@/lib/purchasing/po-ui-status";
import type { PurchaseOrderWithStats } from "@/types/purchasing";
import { ToneBadge } from "../po-dialogs";

const qty = (value?: number | null) => formatNumber(value, 4);

function StatTile({ icon, iconClass, label, children }: { icon: ReactNode; iconClass: string; label: string; children: ReactNode }) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${iconClass}`}>{icon}</span>
          <div>
            <p className="text-xs font-medium text-gray-500">{label}</p>
            {children}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressStage({ label, value, detail, accentClass }: { label: string; value: number; detail: string; accentClass: string }) {
  return (
    <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-gray-600">{label}</span>
        <span className="font-semibold text-gray-900">{Math.round(value)}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full transition-all duration-500 ${accentClass}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-gray-500">{detail}</p>
    </div>
  );
}

function SummaryRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

function overallBarClass(progress: number) {
  if (progress >= 100) return "bg-emerald-500";
  return progress > 0 ? "bg-pink-500" : "bg-gray-400";
}

interface PODetailOverviewProps {
  po: PurchaseOrderWithStats;
  figures: PODetailFigures;
}

/** Kartu statistik, informasi PO, ringkasan keuangan, dan progres per tahap. */
export function PODetailOverview({ po, figures }: PODetailOverviewProps) {
  const status = po.status.toLowerCase();
  const breakdown = poFinancialBreakdown(po);
  const statusTone = poStatusBadge(po.status, "detail");

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={<FileText className="h-5 w-5" />} iconClass="bg-pink-50 text-pink-600" label="Status Purchase Order">
          <div className="mt-1 flex flex-wrap gap-1">
            <ToneBadge tone={statusTone} />
          </div>
        </StatTile>
        <StatTile icon={<Banknote className="h-5 w-5" />} iconClass="bg-blue-50 text-blue-600" label="Total Purchase Order">
          <p className="text-lg font-bold text-gray-900">{formatRupiah(po.grand_total || figures.payableAmount)}</p>
        </StatTile>
        <StatTile icon={<CreditCard className="h-5 w-5" />} iconClass="bg-emerald-50 text-emerald-600" label="Dibayar">
          <p className="text-lg font-bold text-emerald-700">{formatRupiah(po.paid_amount)}</p>
        </StatTile>
        <StatTile icon={<Boxes className="h-5 w-5" />} iconClass="bg-amber-50 text-amber-600" label="Progres Keseluruhan">
          <p className="text-lg font-bold text-gray-900">{figures.overallProgress}%</p>
        </StatTile>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-gray-200/70 shadow-sm lg:col-span-2">
          <CardHeader className="border-b border-gray-100 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5" />
              Informasi Purchase Order
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-sm text-gray-500">Status</Label>
                <div className="flex flex-wrap gap-2">
                  <ToneBadge tone={statusTone} />
                  <ToneBadge tone={poLifecycleBadge(po.lifecycle_status)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-sm text-gray-500">Tanggal PO</Label>
                <div className="font-semibold text-gray-900">{formatDate(po.tanggal_po)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-sm text-gray-500">
                  <User className="h-4 w-4" />
                  Supplier
                </Label>
                <div className="font-semibold text-gray-900">{po.nama_supplier}</div>
                <div className="text-sm text-gray-500">{po.supplier_kode}</div>
              </div>
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-sm text-gray-500">
                  <Calendar className="h-4 w-4" />
                  Estimasi Pengiriman
                </Label>
                <div className="font-semibold text-gray-900">{formatDate(po.tanggal_kirim_estimasi)}</div>
              </div>
            </div>

            {po.catatan && (
              <div className="space-y-1">
                <Label className="text-sm text-gray-500">Catatan</Label>
                <div className="text-gray-700">{po.catatan}</div>
              </div>
            )}

            {po.source_type === "production_order" && (
              <div className="rounded-lg border border-pink-100 bg-pink-50 p-3">
                <Label className="flex items-center gap-1 text-sm text-pink-700">
                  <Factory className="h-4 w-4" />
                  Sumber Purchase Order
                </Label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge className="bg-pink-600 text-white hover:bg-pink-600">Production Order</Badge>
                  {po.production_order_id ? (
                    <Link
                      href={`/dashboard/purchasing/production/orders/${po.production_order_id}`}
                      className="font-medium text-pink-700 hover:underline"
                    >
                      {po.production_order_number || po.source_reference || po.production_order_id}
                    </Link>
                  ) : (
                    <span className="font-medium">{po.source_reference || "-"}</span>
                  )}
                </div>
              </div>
            )}

            {po.alamat_pengiriman && (
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-sm text-gray-500">
                  <MapPin className="h-4 w-4" />
                  Alamat Pengiriman
                </Label>
                <div className="text-gray-700">{po.alamat_pengiriman}</div>
              </div>
            )}

            <div className="mt-4 border-t border-gray-200/70 pt-4">
              <h4 className="mb-3 font-semibold text-gray-900">Pelacakan</h4>
              <div className="space-y-2 text-sm">
                {po.approved_at && <SummaryRow label="Disetujui" value={formatDateTime(po.approved_at)} />}
                {po.sent_at && <SummaryRow label={`Terkirim via ${po.sent_via}`} value={formatDateTime(po.sent_at)} />}
                {po.cancelled_at && <SummaryRow label="Dibatalkan" value={formatDateTime(po.cancelled_at)} />}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-sm">
          <CardHeader className="border-b border-gray-100 pb-4">
            <CardTitle className="text-base">Ringkasan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SummaryRow label="Subtotal" value={formatRupiah(breakdown.subtotal)} />
            {breakdown.discount > 0 && (
              <SummaryRow
                label={`Diskon${po.diskon_persen ? ` (${po.diskon_persen}%)` : ""}`}
                value={`- ${formatRupiah(breakdown.discount)}`}
                valueClass="text-red-500"
              />
            )}
            {breakdown.ppnPercent > 0 && (
              <SummaryRow label={`PPN (${breakdown.ppnPercent}%)`} value={formatRupiah(breakdown.ppnAmount)} />
            )}
            <div className="flex justify-between border-t border-gray-200/70 pt-2 text-lg font-semibold">
              <span>Total</span>
              <span>{formatRupiah(breakdown.total)}</span>
            </div>

            {status !== "cancelled" && (
              <div className="mt-4 border-t border-gray-200/70 pt-4">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900">Progres Keseluruhan Purchase Order</span>
                  <span className="font-semibold text-pink-700">{figures.overallProgress}%</span>
                </div>
                <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full transition-all duration-500 ${overallBarClass(figures.overallProgress)}`}
                    style={{ width: `${Math.min(100, Math.max(0, figures.overallProgress))}%` }}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ProgressStage
                    label="Pemesanan"
                    value={figures.orderProgress}
                    detail={orderProgressDetail(status)}
                    accentClass="bg-blue-500"
                  />
                  <ProgressStage
                    label="Penerimaan"
                    value={figures.receiptProgress}
                    detail={`${qty(po.total_qty_received)} / ${qty(po.total_qty_ordered)} item`}
                    accentClass="bg-amber-500"
                  />
                  <ProgressStage
                    label="Quality Control"
                    value={figures.qcProgress}
                    detail={`${qty(po.total_qty_qc_posted)} / ${qty(po.total_qty_received_grn)} diperiksa`}
                    accentClass="bg-violet-500"
                  />
                  <ProgressStage
                    label="Retur"
                    value={figures.returnProgress}
                    detail={`${qty(po.total_qty_returned)} / ${qty(po.total_qty_qc_posted)} diretur`}
                    accentClass="bg-red-400"
                  />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                    <div className="text-xs text-emerald-700">Pembayaran</div>
                    <div className="mt-1 text-right text-sm font-semibold text-emerald-700">
                      {formatRupiah(po.paid_amount)}
                    </div>
                    <div className="mt-1 text-right text-xs text-emerald-700/80">
                      dari {formatRupiah(figures.payableAmount)} · {figures.paymentProgress}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-pink-100 bg-pink-50 px-3 py-2">
                    <div className="text-xs text-pink-700">Sisa tagihan</div>
                    <div className="mt-1 text-right text-sm font-semibold text-pink-700">
                      {formatRupiah(po.outstanding_amount)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
