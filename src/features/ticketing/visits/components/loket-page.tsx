"use client";

import { useState } from "react";
import { TicketIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { RedeemDialog } from "../../bookings";
import { useTabStats, useVisits } from "../queries";
import type { VisitStatus } from "../types";
import { RegistrationDialog } from "./registration-dialog";
import { VisitDetailDialog } from "./visit-detail-dialog";

export function LoketPage({ canVoidCharges = false }: { canVoidCharges?: boolean }) {
  const [status, setStatus] = useState<VisitStatus>("open");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [detailVisitId, setDetailVisitId] = useState<string | null>(null);

  const visitsQuery = useVisits({ status, q, page });
  const visits = visitsQuery.data?.data ?? [];
  const meta = visitsQuery.data?.meta;
  const stats = useTabStats().data;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Loket & Kasir Ticketing</h1>
        <p className="mt-1 text-sm text-gray-500">
          Registrasi kunjungan, pantau tab berjalan, top-up saldo prepaid, dan
          settlement kasir keluar.
        </p>
      </div>

      {/* Tab monitor live — di-refresh tiap 30 detik */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200/70 bg-white px-4 py-3">
          <p className="text-xs text-gray-500">Kunjungan Berjalan</p>
          <p className="text-2xl font-bold text-gray-900">
            {stats?.open_visits ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200/70 bg-white px-4 py-3">
          <p className="text-xs text-gray-500">Gelang Aktif</p>
          <p className="text-2xl font-bold text-gray-900">
            {stats?.open_bands ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-4 py-3">
          <p className="text-xs text-amber-700">Tagihan Berjalan (Postpaid)</p>
          <p className="text-2xl font-bold text-amber-800">
            {stats ? formatRupiah(stats.outstanding_total) : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 px-4 py-3">
          <p className="text-xs text-emerald-700">Saldo Titipan (Prepaid)</p>
          <p className="text-2xl font-bold text-emerald-800">
            {stats ? formatRupiah(stats.saldo_total) : "—"}
          </p>
        </div>
      </div>

      <PurchasingListSection
        icon={TicketIcon}
        title={status === "open" ? "Kunjungan Berjalan" : "Riwayat Kunjungan"}
        description="Tap gelang pengunjung di gate men-charge tiket; pembelian F&B menumpuk di tab (Fase C)."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Cari nama / WA / UID gelang…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="h-9 w-52"
            />
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as VisitStatus);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Berjalan</SelectItem>
                <SelectItem value="settled">Selesai</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRedeemOpen(true)}
            >
              Redeem Booking
            </Button>
            <Button size="sm" onClick={() => setRegisterOpen(true)}>
              Registrasi Kunjungan
            </Button>
          </div>
        }
      >
        {visitsQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat kunjungan...</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">
                    Penanggung Jawab
                  </th>
                  <th className="px-4 py-3 text-left font-semibold">Mode</th>
                  <th className="px-4 py-3 text-center font-semibold">Gelang</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    {status === "open" ? "Tagihan / Saldo" : "Total"}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold">Waktu</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {visits.map((visit) => (
                  <TableRow key={visit.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{visit.contact_name}</p>
                      {visit.contact_phone ? (
                        <p className="text-xs text-gray-500">{visit.contact_phone}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={`border-0 font-normal ${
                          visit.payment_mode === "prepaid"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {visit.payment_mode === "prepaid" ? "Prepaid" : "Postpaid"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700">
                      {status === "open"
                        ? `${visit.active_band_count}${visit.active_band_count !== visit.band_count ? ` / ${visit.band_count}` : ""}`
                        : visit.band_count}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {visit.payment_mode === "prepaid"
                        ? formatRupiah(visit.saldo)
                        : formatRupiah(visit.outstanding)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDateTime(visit.opened_at)}
                      {visit.settled_at ? ` → ${formatDateTime(visit.settled_at)}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3"
                          onClick={() => setDetailVisitId(visit.id)}
                        >
                          {status === "open" ? "Rincian / Settle" : "Rincian"}
                        </Button>
                      </div>
                    </td>
                  </TableRow>
                ))}
                {visits.length === 0 ? (
                  <TableRow>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                      {status === "open"
                        ? "Tidak ada kunjungan berjalan — klik “Registrasi Kunjungan” untuk memulai."
                        : "Belum ada riwayat."}
                    </td>
                  </TableRow>
                ) : null}
              </tbody>
            </table>
            {meta && meta.totalPages > 1 ? (
              <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
                <span>
                  Hal {meta.page} dari {meta.totalPages} ({meta.total} kunjungan)
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Sebelumnya
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= meta.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Berikutnya
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </PurchasingListSection>

      <RegistrationDialog open={registerOpen} onOpenChange={setRegisterOpen} />
      <RedeemDialog open={redeemOpen} onOpenChange={setRedeemOpen} />
      <VisitDetailDialog
        visitId={detailVisitId}
        onOpenChange={(open) => !open && setDetailVisitId(null)}
        canVoidCharges={canVoidCharges}
      />
    </div>
  );
}
