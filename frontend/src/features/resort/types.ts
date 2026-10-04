import type { ReservationStatus } from "@/lib/resort/reservation";
import type { RoomRow } from "@/lib/resort/types";

/** Kelas badge per status reservasi & kamar (khusus tampilan dashboard). */
export const STATUS_CLASS: Record<ReservationStatus, string> = {
  "menunggu-bayar": "border-amber-300 bg-amber-50 text-amber-800",
  terkonfirmasi: "border-sky-300 bg-sky-50 text-sky-800",
  "check-in": "border-emerald-300 bg-emerald-50 text-emerald-800",
  "check-out": "border-gray-300 bg-gray-50 text-gray-600",
  dibatalkan: "border-rose-300 bg-rose-50 text-rose-700",
  "no-show": "border-orange-300 bg-orange-50 text-orange-700",
};

export const ROOM_STATUS_CLASS: Record<RoomRow["status"], string> = {
  siap: "border-emerald-300 bg-emerald-50 text-emerald-800",
  kotor: "border-amber-300 bg-amber-50 text-amber-800",
  perbaikan: "border-orange-300 bg-orange-50 text-orange-800",
  ditutup: "border-gray-300 bg-gray-100 text-gray-600",
};
export const ROOM_STATUS_LABEL: Record<RoomRow["status"], string> = {
  siap: "Siap dijual", kotor: "Perlu dibersihkan", perbaikan: "Perbaikan", ditutup: "Ditutup",
};
