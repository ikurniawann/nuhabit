"use client";

import { useState } from "react";
import { BedSingle, DoorOpen, Loader2, LogIn, LogOut, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate, formatRupiah } from "@/lib/format";
import { wibDateString } from "@/lib/pos/report-period";
import { RESERVATION_STATUS_LABELS } from "@/lib/resort/reservation";
import type { FrontOfficeBoard, ReservationListRow, RoomRow } from "@/lib/resort/types";
import { cn } from "@/lib/utils";
import { ReservationDetailDialog } from "@/features/resort/components/reservation-detail-dialog";
import { resortApi, useFrontOffice, useResortMutation } from "@/features/resort/queries";
import { ROOM_STATUS_CLASS, ROOM_STATUS_LABEL, STATUS_CLASS } from "@/features/resort/types";

type BoardRoom = FrontOfficeBoard["rooms"][number];

/**
 * Resort → Front Office (owner 2026-09-06): papan kerja harian resepsionis —
 * kedatangan, keberangkatan, tamu menginap, okupansi, dan status housekeeping
 * kamar. Klik kartu tamu untuk check-in/check-out & folio.
 */
export function ResortFrontOfficePage() {
  const [date, setDate] = useState(() => wibDateString(new Date()));
  const [detailId, setDetailId] = useState<string | null>(null);
  const boardQuery = useFrontOffice(date);
  const board = boardQuery.data;
  const roomStatus = useResortMutation(
    async ({ room, status }: { room: BoardRoom; status: RoomRow["status"] }) => {
      await resortApi.saveRoom(room.id, { status });
      return { message: `${room.name}: ${ROOM_STATUS_LABEL[status]}` };
    },
    "Status kamar diperbarui"
  );
  const setRoomStatus = (room: BoardRoom, status: RoomRow["status"]) => roomStatus.mutate({ room, status });

  const cards: Array<[string, string, string]> = board
    ? [
        ["Okupansi", `${board.summary.occupancy_pct}%`, `${board.summary.occupied} dari ${board.summary.rooms_total} kamar`],
        ["Kedatangan", String(board.summary.arrivals), "check-in hari ini"],
        ["Keberangkatan", String(board.summary.departures), "check-out hari ini"],
        ["Kamar kosong", String(board.summary.vacant), "siap dijual / perlu bersih"],
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><DoorOpen className="h-6 w-6 text-brand-text" />Front Office</h1>
          <p className="mt-1 text-sm text-muted-foreground">Kedatangan, keberangkatan, tamu menginap, dan status kamar.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-muted-foreground">Tanggal
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-9" />
          </label>
          <Button variant="outline" className="h-9" onClick={() => void boardQuery.refetch()}><RefreshCw className="mr-1.5 h-4 w-4" />Muat ulang</Button>
        </div>
      </div>

      {!board ? (
        <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          {boardQuery.isError
            ? boardQuery.error.message || "Gagal memuat papan front office"
            : <><Loader2 className="h-4 w-4 animate-spin" />Memuat…</>}
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map(([label, value, hint]) => (
              <Card key={label}><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </CardContent></Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <GuestList title="Kedatangan" icon={<LogIn className="h-4 w-4" />} rows={board.arrivals}
              empty="Tidak ada kedatangan pada tanggal ini." onOpen={setDetailId} />
            <GuestList title="Keberangkatan" icon={<LogOut className="h-4 w-4" />} rows={board.departures}
              empty="Tidak ada keberangkatan pada tanggal ini." onOpen={setDetailId} />
            <GuestList title="Sedang menginap" icon={<Users className="h-4 w-4" />} rows={board.in_house}
              empty="Belum ada tamu menginap." onOpen={setDetailId} showRooms />
          </div>

          <div>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <BedSingle className="h-4 w-4" /> Status kamar
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {board.rooms.map((room) => (
                <Card key={room.id} className={cn(room.guest_name && "border-emerald-300")}>
                  <CardContent className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{room.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{room.code} · {room.room_type_name}</p>
                      </div>
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium", ROOM_STATUS_CLASS[room.status])}>
                        {ROOM_STATUS_LABEL[room.status]}
                      </span>
                    </div>
                    {room.guest_name ? (
                      <p className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                        {room.guest_name} · sampai {formatDate(room.occupied_until)}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(["siap", "kotor", "perbaikan"] as const)
                          .filter((s) => s !== room.status)
                          .map((s) => (
                            <button key={s} type="button" onClick={() => setRoomStatus(room, s)}
                              className="rounded-md border px-2 py-1 text-[11px] hover:bg-muted">
                              → {ROOM_STATUS_LABEL[s]}
                            </button>
                          ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {board.rooms.length === 0 && (
                <Card className="col-span-full"><CardContent className="p-6 text-center text-sm text-muted-foreground">
                  Belum ada unit kamar. Tambahkan di menu Kamar &amp; Tipe.
                </CardContent></Card>
              )}
            </div>
          </div>
        </>
      )}

      {detailId && <ReservationDetailDialog id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function GuestList({ title, icon, rows, empty, onOpen, showRooms }: {
  title: string; icon: React.ReactNode; rows: ReservationListRow[]; empty: string;
  onOpen: (id: string) => void; showRooms?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm font-semibold">
          <span className="flex items-center gap-2">{icon}{title}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{rows.length}</span>
        </div>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onOpen(r.id)} className="w-full px-4 py-3 text-left hover:bg-muted/50">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{r.guest_name}</p>
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium", STATUS_CLASS[r.status])}>
                      {RESERVATION_STATUS_LABELS[r.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.reservation_code} · {r.room_count} kamar{showRooms && r.rooms_label ? ` (${r.rooms_label})` : ""} · {r.nights} malam
                  </p>
                  <p className="mt-0.5 text-xs">
                    <span className="text-muted-foreground">Total {formatRupiah(r.total)}</span>
                    {r.balance > 0 && <span className="ml-2 font-medium text-amber-700">sisa {formatRupiah(r.balance)}</span>}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
