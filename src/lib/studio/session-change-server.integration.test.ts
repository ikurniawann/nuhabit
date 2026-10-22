/**
 * Test integrasi kabar perubahan jadwal ke member (EPIC-067 T-067-A6) terhadap
 * Postgres sungguhan. HANYA jalan bila DATABASE_URL menunjuk database *_test.
 * Pengiriman WA di-mock — tidak ada pesan yang benar-benar terkirim.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent: { target: string; message: string }[] = [];
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppText: vi.fn(async (m: { target: string; message: string }) => {
    sent.push(m);
    return { success: true };
  }),
}));

import { query, queryOne } from "@/lib/db";
import { cancelBooking } from "./booking-server";
import { flushChangeNotices, listSessionChanges, queueSessionChangeNotices } from "./session-change-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const tag = branchId.slice(0, 8);
const coach: Record<string, string> = {};
const members: Record<string, string> = {};
let sessionId = "";
let sessionAt = { date: "", time: "" };
let laterSessionId = "";
const bookings: Record<string, string> = {};

/**
 * Sesi di tanggal N jam dari sekarang (WIB), selalu pukul 10.00 — jam tetap
 * supaya jam selesai (+1 jam) tidak melewati tengah malam (constraint
 * end_time > start_time). Untuk N ≥ 30 sesi tetap ≥ 16 jam ke depan.
 */
function wibAt(hoursFromNow: number) {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000 + 7 * 3_600_000);
  return { date: d.toISOString().slice(0, 10), time: "10:00" };
}

describe.skipIf(!IS_TEST_DB)("kabar perubahan jadwal ke member (DB)", () => {
  beforeAll(async () => {
    for (const k of ["pras", "rara"]) {
      coach[k] = (await query<{ id: string }>(
        `INSERT INTO studio.coaches (company_id, branch_id, full_name) VALUES ($1, $1, $2) RETURNING id`,
        [branchId, `Coach ${k} ${tag}`]
      ))[0].id;
    }
    const program = (await query<{ id: string }>(
      `INSERT INTO studio.programs (company_id, branch_id, code, name, kind) VALUES ($1, $1, $2, 'Hyrox Engine', 'class') RETURNING id`,
      [branchId, `A6-${tag}`]
    ))[0].id;
    const at = wibAt(30);
    sessionAt = at;
    sessionId = (await query<{ id: string }>(
      `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id)
       VALUES ($1, $1, $2, $3::time, $3::time + interval '1 hour', $4, 10, $5) RETURNING id`,
      [branchId, at.date, at.time, program, coach.pras]
    ))[0].id;
    const later = wibAt(100);
    laterSessionId = (await query<{ id: string }>(
      `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id)
       VALUES ($1, $1, $2, $3::time, $3::time + interval '1 hour', $4, 10, $5) RETURNING id`,
      [branchId, later.date, later.time, program, coach.pras]
    ))[0].id;
    for (const [k, phone, status] of [["maya", "081234500001", "booked"], ["nana", "081234500002", "waitlisted"], ["tanpa", "-", "booked"], ["batal", "081234500003", "cancelled"]]) {
      members[k] = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, $2) RETURNING id`, [`${k} ${tag}`, phone]))[0].id;
      bookings[k] = (await query<{ id: string }>(
        `INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status, booked_at) VALUES ($1, $1, $2, $3, $4, now() - interval '2 days') RETURNING id`,
        [branchId, sessionId, members[k], status]
      ))[0].id;
    }
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.settings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.member_notifications WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.bookings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.class_sessions WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM pos.pos_customers WHERE id = ANY($1::uuid[])`, [Object.values(members)]);
  });

  it("coach diganti: antre untuk booked + waitlist (bukan yang batal), nomor tidak valid di-skip, tepat sekali", async () => {
    await query(`UPDATE studio.class_sessions SET coach_id = $2, original_coach_id = $3 WHERE id = $1`, [sessionId, coach.rara, coach.pras]);
    const first = await queueSessionChangeNotices(sessionId, { kind: "coach_changed", oldCoachName: `Coach pras ${tag}` });
    expect(first.queued).toBe(3);
    expect((await queueSessionChangeNotices(sessionId, { kind: "coach_changed", oldCoachName: null })).queued).toBe(0);

    const rows = await query<{ customer_id: string; status: string; message: string }>(
      `SELECT customer_id, status, message FROM studio.member_notifications WHERE session_id = $1 ORDER BY status`,
      [sessionId]
    );
    expect(rows.map((r) => r.status).sort()).toEqual(["pending", "pending", "skipped"]);
    expect(rows.find((r) => r.customer_id === members.maya)?.message).toContain(`Coach rara ${tag} will coach this session instead of Coach pras ${tag}`);
    expect(rows.find((r) => r.customer_id === members.nana)?.message).toContain("still on the waitlist");
    const s = await queryOne<{ change_kind: string; coach_changed_at: string | null; change_notice_late: boolean }>(
      `SELECT change_kind, coach_changed_at, change_notice_late FROM studio.class_sessions WHERE id = $1`, [sessionId]
    );
    expect(s).toMatchObject({ change_kind: "coach_changed", change_notice_late: false });
    expect(s?.coach_changed_at).not.toBeNull();
  });

  it("flush di jam layak mengirim; tengah malam menahan kelas yang masih jauh", async () => {
    // 23.00 WIB dua hari sebelum kelas: kelas masih jauh → ditahan sampai pagi.
    const twoDaysBefore = new Date(Date.parse(`${sessionAt.date}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
    const night = new Date(`${twoDaysBefore}T23:00:00+07:00`);
    expect(await flushChangeNotices(night, sessionId)).toEqual({ sent: 0, failed: 0, held: 2 });
    expect(sent).toHaveLength(0);

    // 12.00 WIB sehari sebelum kelas: jam layak → terkirim.
    const dayBefore = new Date(Date.parse(`${sessionAt.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const noon = new Date(`${dayBefore}T12:00:00+07:00`);
    const r = await flushChangeNotices(noon, sessionId);
    expect(r.sent).toBe(2);
    expect(sent.map((m) => m.target).sort()).toEqual(["6281234500001", "6281234500002"]);
    expect((await flushChangeNotices(noon, sessionId)).sent).toBe(0);
  });

  it("booking sebelum coach diganti boleh batal gratis walau lewat batas batal", async () => {
    // Kelas ±30 jam lagi, batas batal dipaksa 48 jam → normalnya kredit hangus.
    await query(
      `INSERT INTO studio.settings (branch_id, key, value) VALUES ($1, 'cancel_window_hours', '48'::jsonb)
       ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [branchId]
    );
    const res = await cancelBooking({ companyId: branchId, branchId, actorId: null, staff: false }, bookings.maya, { customerId: members.maya });
    expect(res).toMatchObject({ status: "cancelled", refunded: true });
    await query(`DELETE FROM studio.settings WHERE branch_id = $1`, [branchId]);
  });

  it("kelas batal: antre sebelum booking dilepas; laporan menghitung status & tanda terlambat", async () => {
    await query(`INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status) VALUES ($1, $1, $2, $3, 'booked')`, [branchId, laterSessionId, members.maya]);
    await query(`INSERT INTO studio.settings (branch_id, key, value) VALUES ($1, 'leave_member_notice_min_hours', '200'::jsonb)`, [branchId]);
    const q = await queueSessionChangeNotices(laterSessionId, { kind: "cancelled" });
    expect(q).toEqual({ queued: 1, late: true });
    const msg = await queryOne<{ message: string }>(`SELECT message FROM studio.member_notifications WHERE session_id = $1`, [laterSessionId]);
    expect(msg?.message).toContain("has been cancelled");

    const report = await listSessionChanges(branchId);
    const later = report.find((r) => r.session_id === laterSessionId);
    expect(later).toMatchObject({ change_kind: "cancelled", change_notice_late: true, pending: 1 });
    const first = report.find((r) => r.session_id === sessionId);
    expect(first).toMatchObject({ change_kind: "coach_changed", sent: 2, skipped: 1, original_coach_name: `Coach pras ${tag}` });
  });
});
