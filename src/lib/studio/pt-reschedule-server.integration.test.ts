/**
 * Test integrasi reschedule Personal Training (EPIC-067 T-067-A7) terhadap
 * Postgres sungguhan. HANYA jalan bila DATABASE_URL menunjuk database *_test;
 * fixture dihapus sesudahnya. WA (coach & member) di-mock.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const staffWa: { key: string; phone: string | null; message: string }[] = [];
vi.mock("@/lib/studio/staff-wa", () => ({
  sendStaffWa: vi.fn(async (_t: string, key: string, phone: string | null, message: string) => {
    staffWa.push({ key, phone, message });
    return Boolean(phone);
  }),
}));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppText: vi.fn(async () => ({ success: true })) }));

import { query, queryOne } from "@/lib/db";
import { cancelBooking, type BookingActor } from "./booking-server";
import { wibNow } from "./jobs";
import { createPtBooking } from "./pt-server";
import { listBookingReschedules, reschedulePtBooking } from "./pt-reschedule-server";
import { addDays } from "./schedule";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const tag = branchId.slice(0, 8);
const staff: BookingActor = { companyId: branchId, branchId, actorId: null, staff: true };
const member: BookingActor = { ...staff, staff: false };
const coach: Record<string, string> = {};
let programId = "";
let customerId = "";
let bookingId = "";
let sessionId = "";
const today = wibNow().date;
const d3 = addDays(today, 3);
const d4 = addDays(today, 4);

const session = () =>
  queryOne<{ session_date: string; start_time: string; coach_id: string; studio_rescheduled_at: string | null; change_kind: string | null }>(
    `SELECT session_date::text AS session_date, to_char(start_time,'HH24:MI') AS start_time, coach_id, studio_rescheduled_at, change_kind
     FROM studio.class_sessions WHERE id = $1`,
    [sessionId]
  );

describe.skipIf(!IS_TEST_DB)("reschedule Personal Training (DB)", () => {
  beforeAll(async () => {
    programId = (await query<{ id: string }>(
      `INSERT INTO studio.programs (company_id, branch_id, code, name, kind, duration_minutes) VALUES ($1, $1, $2, 'Personal Training 1:1', 'pt', 60) RETURNING id`,
      [branchId, `A7-${tag}`]
    ))[0].id;
    for (const [k, phone] of [["pras", "081277700071"], ["rara", "081277700072"]] as const) {
      coach[k] = (await query<{ id: string }>(
        `INSERT INTO studio.coaches (company_id, branch_id, full_name, phone, is_public) VALUES ($1, $1, $2, $3, true) RETURNING id`,
        [branchId, `Coach ${k} ${tag}`, phone]
      ))[0].id;
      await query(`INSERT INTO studio.coach_programs (coach_id, program_id, branch_id) VALUES ($1, $2, $3)`, [coach[k], programId, branchId]);
      for (let wd = 1; wd <= 7; wd++) {
        await query(
          `INSERT INTO studio.coach_availability (company_id, branch_id, coach_id, weekday, start_time, end_time) VALUES ($1, $1, $2, $3, '06:00', '21:00')`,
          [branchId, coach[k], wd]
        );
      }
    }
    customerId = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, '081277700073') RETURNING id`, [`Maya ${tag}`]))[0].id;
    const product = (await query<{ id: string }>(
      `INSERT INTO studio.pass_products (company_id, branch_id, code, name, validity_days, price, pt_credits) VALUES ($1, $1, $2, 'PT 5', 10, 0, 5) RETURNING id`,
      [branchId, `A7P-${tag}`]
    ))[0].id;
    await query(
      `INSERT INTO studio.member_passes (company_id, branch_id, pass_code, customer_id, product_id, product_name, category, price_paid, valid_from, valid_until, pt_credits_total)
       VALUES ($1, $1, $2, $3, $4, 'PT 5', 'pt', 0, $5::date, $6::date, 5)`,
      [branchId, `A7-${tag}`, customerId, product, today, addDays(today, 10)]
    );
    const b = await createPtBooking(staff, { customer_id: customerId, program_id: programId, coach_id: coach.pras, date: d3, start_time: "07:00", source: "front_desk" });
    bookingId = b.booking_id;
    sessionId = b.session_id;
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.settings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.member_notifications WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.pt_reschedules WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.pass_credit_ledger WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.bookings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.class_sessions WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.member_passes WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.pass_products WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coach_availability WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coach_programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM pos.pos_customers WHERE id = $1`, [customerId]);
  });

  it("member memindah ke jam lain coach yang sama: sesi & kredit tetap, coach dikabari, member tidak", async () => {
    const res = await reschedulePtBooking(member, { booking_id: bookingId, date: d3, start_time: "09:00" }, { by: "member", customerId });
    expect(res).toMatchObject({ session_id: sessionId, to: { date: d3, time: "09:00", end_time: "10:00", coach_id: coach.pras }, member_notified: false });
    expect(await session()).toMatchObject({ session_date: d3, start_time: "09:00", studio_rescheduled_at: null });
    const ledger = await query<{ entry_type: string }>(`SELECT entry_type FROM studio.pass_credit_ledger WHERE booking_id = $1`, [bookingId]);
    expect(ledger.map((l) => l.entry_type)).toEqual(["redeem"]);
    expect(staffWa).toHaveLength(1);
    expect(staffWa[0].message).toContain("dipindah oleh member");
    expect(await query(`SELECT 1 FROM studio.member_notifications WHERE session_id = $1`, [sessionId])).toHaveLength(0);
  });

  it("member dibatasi jumlah reschedule dan jam yang bentrok / di luar masa pass", async () => {
    await expect(
      reschedulePtBooking(member, { booking_id: bookingId, date: addDays(today, 11), start_time: "09:00" }, { by: "staff" })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Pass member berlaku") });

    const other = await query<{ id: string }>(
      `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id)
       VALUES ($1, $1, $2, '12:00', '13:00', $3, 1, $4) RETURNING id`,
      [branchId, d3, programId, coach.pras]
    );
    await expect(reschedulePtBooking(staff, { booking_id: bookingId, date: d3, start_time: "12:30" }, { by: "staff" })).rejects.toMatchObject({ status: 409 });
    await query(`DELETE FROM studio.class_sessions WHERE id = $1`, [other[0].id]);

    await query(`INSERT INTO studio.settings (branch_id, key, value) VALUES ($1, 'pt_member_reschedule_max', '1')`, [branchId]);
    await expect(
      reschedulePtBooking(member, { booking_id: bookingId, date: d3, start_time: "10:00" }, { by: "member", customerId })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("limit 1") });
    await expect(
      reschedulePtBooking(member, { booking_id: bookingId, date: d3, start_time: "10:00" }, { by: "member", customerId: randomUUID() })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("coach memindah: member diantrekan WA + boleh batal gratis, pengingat H-1 dibuka lagi, coach lain tidak bisa", async () => {
    await query(
      `INSERT INTO studio.member_notifications (branch_id, customer_id, kind, dedup_key, phone, message, status) VALUES ($1, $2, 'session_reminder', $3, '6281277700073', 'x', 'sent')`,
      [branchId, customerId, `session:${bookingId}`]
    );
    await expect(
      reschedulePtBooking(staff, { booking_id: bookingId, date: d4, start_time: "10:00" }, { by: "coach", coachId: coach.rara })
    ).rejects.toMatchObject({ status: 404 });

    staffWa.length = 0;
    const res = await reschedulePtBooking(staff, { booking_id: bookingId, date: d4, start_time: "10:00", reason: "Ada event" }, { by: "coach", coachId: coach.pras });
    expect(res.member_notified).toBe(true);
    expect(staffWa).toHaveLength(0);
    const s = await session();
    expect(s).toMatchObject({ session_date: d4, start_time: "10:00", change_kind: "rescheduled" });
    expect(s?.studio_rescheduled_at).not.toBeNull();
    const n = await query<{ kind: string; message: string }>(`SELECT kind, message FROM studio.member_notifications WHERE customer_id = $1`, [customerId]);
    expect(n.map((x) => x.kind)).toEqual(["session_rescheduled"]);
    expect(n[0].message).toContain("has been moved");
    expect(n[0].message).toContain("Note from the studio: Ada event");
  });

  it("admin mengganti coach: WA ke coach lama & baru, riwayat lengkap; batal telat tetap kredit kembali", async () => {
    staffWa.length = 0;
    await reschedulePtBooking(staff, { booking_id: bookingId, date: d4, start_time: "11:00", coach_id: coach.rara }, { by: "staff" });
    expect((await session())?.coach_id).toBe(coach.rara);
    expect(staffWa.map((w) => w.key.split(":").pop()).sort()).toEqual(["in", "out"]);
    expect(staffWa.find((w) => w.key.endsWith(":out"))?.message).toContain(`dipindahkan ke Coach rara ${tag}`);
    // Kabar reschedule sebelumnya yang belum terkirim digantikan yang terbaru.
    const pending = await query(`SELECT 1 FROM studio.member_notifications WHERE session_id = $1 AND status = 'pending'`, [sessionId]);
    expect(pending.length).toBeLessThanOrEqual(1);

    const history = await listBookingReschedules(branchId, bookingId);
    expect(history.map((h) => [h.actor_kind, h.from_start, h.to_start])).toEqual([
      ["staff", "10:00", "11:00"],
      ["coach", "09:00", "10:00"],
      ["member", "07:00", "09:00"],
    ]);

    // Batas batal sangat panjang → biasanya batal telat; karena dipindah studio, kredit tetap kembali.
    await query(`INSERT INTO studio.settings (branch_id, key, value) VALUES ($1, 'cancel_window_hours', '72')`, [branchId]);
    const c = await cancelBooking(member, bookingId, { customerId });
    expect(c).toMatchObject({ status: "cancelled", refunded: true });
  });
});
