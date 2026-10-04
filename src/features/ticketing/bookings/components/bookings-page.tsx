"use client";

import { useState } from "react";
import { GlobeAltIcon } from "@heroicons/react/24/outline";
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
import { todayInJakarta } from "@/lib/ticketing/booking";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { useBookings } from "../queries";
import {
  BOOKING_STATUS_BADGES,
  BOOKING_STATUS_LABELS,
  type BookingStatus,
} from "../types";
import { BookingDetailDialog } from "./booking-detail-dialog";
import { OccupancyCalendar } from "./occupancy-calendar";

const ALL_STATUS = "semua" as const;

/**
 * Dashboard kelola booking website (D5) — list per tanggal + aksi.
 * canManage=false (loket): lihat + kirim ulang WA saja — aksi ber-uang
 * disembunyikan (server tetap menolak terlepas dari UI).
 */
export function BookingsPage({ canManage = false }: { canManage?: boolean }) {
  const [date, setDate] = useState(() => todayInJakarta());
  const [status, setStatus] = useState<BookingStatus | typeof ALL_STATUS>(ALL_STATUS);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const bookingsQuery = useBookings({
    date,
    status: status === ALL_STATUS ? "" : status,
    q,
    page,
  });
  const bookings = bookingsQuery.data?.data ?? [];
  const meta = bookingsQuery.data?.meta;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Booking Online</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pemesanan dari website booking publik — pantau pembayaran Xendit,
          batalkan, catat refund manual, dan kirim ulang WA kode booking.
        </p>
      </div>

      <OccupancyCalendar
        selectedDate={date}
        onSelectDate={(iso) => {
          setDate(iso);
          setPage(1);
        }}
      />

      <PurchasingListSection
        icon={GlobeAltIcon}
        title="Daftar Booking"
        description="Booking terbayar di-redeem petugas loket pada hari-H menjadi kunjungan prepaid."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setPage(1);
              }}
              className="h-9 w-40"
            />
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as BookingStatus | typeof ALL_STATUS);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUS}>Semua Status</SelectItem>
                {Object.entries(BOOKING_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Cari kode / nama / WA…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="h-9 w-48"
            />
          </div>
        }
      >
        {bookingsQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat booking...</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Kode</th>
                  <th className="px-4 py-3 text-left font-semibold">Pemesan</th>
                  <th className="px-4 py-3 text-left font-semibold">Kunjungan</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Dibuat</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {bookings.map((booking) => (
                  <TableRow key={booking.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-900">
                      {booking.booking_code}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {booking.customer_name}
                      </p>
                      <p className="text-xs text-gray-500">{booking.customer_phone}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{booking.visit_date}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatRupiah(booking.total)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={`border-0 font-normal ${BOOKING_STATUS_BADGES[booking.status]}`}
                      >
                        {BOOKING_STATUS_LABELS[booking.status]}
                      </Badge>
                      {booking.webhook_alert ? (
                        <p className="mt-0.5 text-[11px] font-medium text-red-600">
                          ⚠ perlu perhatian
                        </p>
                      ) : null}
                      {booking.refund_note ? (
                        <p className="mt-0.5 text-[11px] text-gray-400">
                          ada catatan refund
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDateTime(booking.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3"
                          onClick={() => setDetailId(booking.id)}
                        >
                          Rincian
                        </Button>
                      </div>
                    </td>
                  </TableRow>
                ))}
                {bookings.length === 0 ? (
                  <TableRow>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-sm text-gray-500"
                    >
                      Tidak ada booking untuk filter ini.
                    </td>
                  </TableRow>
                ) : null}
              </tbody>
            </table>
            {meta && meta.totalPages > 1 ? (
              <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
                <span>
                  Hal {meta.page} dari {meta.totalPages} ({meta.total} booking)
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

      <BookingDetailDialog
        bookingId={detailId}
        canManage={canManage}
        onOpenChange={(open) => !open && setDetailId(null)}
      />
    </div>
  );
}
