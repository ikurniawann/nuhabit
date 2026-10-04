/**
 * EPIC-023 — penghangus booking (keputusan owner 2026-07-23).
 *
 * Booking `terbayar` yang tidak pernah di-redeem dan sudah melewati masa
 * berlaku (visit_date + booking_forfeit_days venue) → status `hangus` +
 * `forfeited_at` = tanggal pengakuan pendapatan hangus di laporan.
 *
 * Kebijakan per venue di ticket_settings.booking_forfeit_days (diisi SOP);
 * NULL = venue itu tidak menghanguskan apa pun. Transisi UPDATE-WHERE-status
 * idempotent — dua proses/tick tidak menghanguskan dua kali, dan booking
 * yang keburu di-redeem (status berubah) tidak tersentuh.
 */

import { getPool } from "@/lib/db";
import { todayInJakarta } from "./booking";

const CHECK_INTERVAL_MS = 60 * 60_000; // per jam — kejadiannya harian

export async function forfeitOverdueBookings(): Promise<{ forfeited: number }> {
  const pool = getPool();
  const result = await pool.query<{ id: string; booking_code: string }>(
    `UPDATE ticketing.ticket_bookings b
        SET status = 'hangus', forfeited_at = now(), updated_at = now()
       FROM ticketing.ticket_settings s
      WHERE s.branch_id = b.branch_id AND s.company_id = b.company_id
        AND s.booking_forfeit_days IS NOT NULL
        AND b.status = 'terbayar'
        AND b.visit_id IS NULL
        AND b.visit_date + s.booking_forfeit_days < $1::date
      RETURNING b.id, b.booking_code`,
    [todayInJakarta()]
  );
  if (result.rows.length > 0) {
    console.log(
      `[ticketing] ${result.rows.length} booking dihanguskan: ` +
        result.rows.map((r) => r.booking_code).join(", ")
    );
  }
  return { forfeited: result.rows.length };
}

let started = false;

/** Daftarkan pengecekan berkala — sekali per proses server (pola watcher lain). */
export function startBookingForfeitWatcher(): void {
  if (started) return;
  started = true;

  const tick = () => {
    forfeitOverdueBookings().catch((error) => {
      console.error("[ticketing] penghangus booking gagal:", error);
    });
  };
  setTimeout(tick, 60_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
