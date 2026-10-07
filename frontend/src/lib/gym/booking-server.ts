import "server-only";
/**
 * Jadwal kelas, booking, dan gate check-in gym di atas PostgreSQL. Aturan
 * murninya di ./booking. Pintu masuk stabil: isi dipecah per tanggung jawab,
 * modul ini hanya mengekspor ulang API publiknya.
 * - booking-store: SchedulingError, bentuk baris, kunci, sinkron kursi, penalti
 * - session-queries: daftar sesi, peserta, pratinjau batal, booking, log gate
 * - booking-actions-server: booking, batal, waitlist, no-show
 * - gym-checkin-server: scan QR, check-in booking, check-in manual
 * - session-admin-server: CRUD & siklus hidup sesi, salin minggu
 *
 * Kredit tidak dipotong saat booking. Potongan terjadi saat check-in, batal
 * terlambat, atau no-show (kebijakan forfeit), selalu lewat deductCredits.
 */
export { SchedulingError, type SessionRow } from "./booking-store";
export {
  attachCancelInfo,
  getSession,
  listSessions,
  sessionRoster,
  type CancelInfo,
  type RosterEntry,
  type SessionFilter,
  type SessionSummary,
} from "./session-queries";
export {
  bookSession,
  cancelBooking,
  confirmWaitlistOffer,
  markNoShow,
  type BookResult,
  type CancelResult,
} from "./booking-actions-server";
export {
  checkInBooking,
  checkInBookingManually,
  scanGymQr,
  type CheckInSource,
  type GymCheckInResult,
} from "./gym-checkin-server";
export {
  cancelSession,
  completeSession,
  createSession,
  deleteSession,
  duplicateWeek,
  publishSession,
  updateSession,
  type SessionInput,
  type SessionPatch,
} from "./session-admin-server";
