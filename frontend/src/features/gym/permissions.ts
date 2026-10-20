import { useIamAccess } from "@/components/iam/iam-access-provider";

/*
 * Menu IAM yang dicek guard API gym (prefix sama dengan backend/internal/platform/iam).
 * Salah satu menu dengan aksi yang diminta sudah cukup.
 */

/** Sesi dan jadwal: buat, ubah, tutup, batal, hapus. */
export const SCHEDULE_MENUS = ["gym.schedule", "gym.sessions"] as const;
/** Front desk: daftarkan member ke kelas. */
export const DESK_MENUS = ["gym.bookings", "gym.checkin", "gym.sessions"] as const;
/** Ubah booking: batalkan, tandai tidak hadir. */
export const BOOKING_MENUS = ["gym.bookings", "gym.sessions"] as const;
/** Check-in di gate. */
export const CHECKIN_MENUS = ["gym.checkin", "gym.sessions"] as const;

/**
 * Aksi booking yang boleh dijalankan user (bookingActionGrants di
 * gymscheduling). Coach dengan read_own hanya check-in dan tandai tidak
 * hadir; server sudah membatasi daftarnya ke kelas coach itu.
 */
export function useBookingActions() {
  const { can } = useIamAccess();
  const own = can("gym.sessions", "read_own");
  return {
    cancel: can(BOOKING_MENUS, "update"),
    noShow: can(BOOKING_MENUS, "update") || own,
    checkIn: can(CHECKIN_MENUS, "create") || can("gym.bookings", "update") || own,
  };
}
