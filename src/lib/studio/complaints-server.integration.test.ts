/**
 * Test integrasi tiket keluhan (EPIC-067 T-067-B1). HANYA jalan bila
 * DATABASE_URL menunjuk database *_test; fixture dihapus sesudahnya.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, queryOne } from "@/lib/db";
import { createComplaint, createComplaintFromWa, getComplaint, listComplaints, memberSessionsForComplaint } from "./complaints-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const venue = { companyId: branchId, branchId };
const tag = branchId.slice(0, 8);
const userId = randomUUID();
let coachId = "";
let customerId = "";
let sessionId = "";
let convId = "";
const now = new Date("2026-10-22T03:00:00Z");

describe.skipIf(!IS_TEST_DB)("tiket keluhan (DB)", () => {
  beforeAll(async () => {
    coachId = (await query<{ id: string }>(`INSERT INTO studio.coaches (company_id, branch_id, full_name) VALUES ($1, $1, $2) RETURNING id`, [branchId, `Coach B1 ${tag}`]))[0].id;
    customerId = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, $2) RETURNING id`, [`Maya B1 ${tag}`, `x-b1-${tag}`]))[0].id;
    const program = (await query<{ id: string }>(`INSERT INTO studio.programs (company_id, branch_id, code, name, kind) VALUES ($1, $1, $2, 'Hyrox Engine', 'class') RETURNING id`, [branchId, `B1-${tag}`]))[0].id;
    sessionId = (await query<{ id: string }>(
      `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id)
       VALUES ($1, $1, (now() AT TIME ZONE 'Asia/Jakarta')::date - 1, '07:00', '08:00', $2, 10, $3) RETURNING id`,
      [branchId, program, coachId]
    ))[0].id;
    await query(`INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status) VALUES ($1, $1, $2, $3, 'attended')`, [branchId, sessionId, customerId]);
    convId = (await query<{ id: string }>(
      `INSERT INTO crm.wa_conversations (external_id, phone, customer_id, display_name, category, priority, last_message_preview, channel, status)
       VALUES ($1, '6281200000000', $2, 'Maya K', 'pembayaran', 'high', 'Saya ditagih dua kali untuk paket bulan ini', 'whatsapp', 'open') RETURNING id`,
      [`b1-${tag}`, customerId]
    ))[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.complaints WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM crm.wa_conversations WHERE id = $1`, [convId]);
    await query(`DELETE FROM studio.bookings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.class_sessions WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM pos.pos_customers WHERE id = $1`, [customerId]);
  });

  it("front desk: sesi menentukan coach, batas waktu cedera, kode berurutan, riwayat 'dibuat'", async () => {
    const a = await createComplaint(venue, userId, { source: "front_desk", category: "injury", description: "Bahu kiri cedera saat sled push", customer_id: customerId, session_id: sessionId }, now);
    const b = await createComplaint(venue, userId, { source: "front_desk", category: "facility", title: "AC ruang 2 mati", contact_name: "Tamu walk-in" }, now);
    expect(Number(b.code.slice(-4))).toBe(Number(a.code.slice(-4)) + 1);
    expect(a.code).toMatch(/^KEL-2610-\d{4}$/);

    const detail = (await getComplaint(branchId, a.id))!;
    expect(detail).toMatchObject({ category: "injury", priority: "high", status: "received", coach_id: coachId, member_name: `Maya B1 ${tag}`, title: "Bahu kiri cedera saat sled push" });
    expect(detail.session_label).toContain("Hyrox Engine");
    expect(new Date(detail.respond_by!).toISOString()).toBe("2026-10-22T05:00:00.000Z");
    expect(detail.events.map((e) => e.kind)).toEqual(["created"]);
  });

  it("dari WA: kategori pembayaran → billing, prioritas & member dari percakapan, percakapan ditandai komplain; tidak dobel", async () => {
    const t = await createComplaintFromWa(venue, userId, convId);
    const d = (await getComplaint(branchId, t.id))!;
    expect(d).toMatchObject({ source: "wa", category: "billing", priority: "high", customer_id: customerId, contact_name: "Maya K", wa_conversation_id: convId });
    expect(d.description).toContain("ditagih dua kali");
    expect((await queryOne<{ is_complaint: boolean }>(`SELECT is_complaint FROM crm.wa_conversations WHERE id = $1`, [convId]))?.is_complaint).toBe(true);
    await expect(createComplaintFromWa(venue, userId, convId)).rejects.toMatchObject({ status: 409, details: { id: t.id } });
  });

  it("daftar: terbuka dulu, prioritas tertinggi dulu; filter kategori & pencarian", async () => {
    const all = await listComplaints(branchId, { status: "open" });
    expect(all).toHaveLength(3);
    expect(all[0].priority).toBe("high");
    expect((await listComplaints(branchId, { category: "facility" })).map((r) => r.title)).toEqual(["AC ruang 2 mati"]);
    expect((await listComplaints(branchId, { q: "walk-in" })).map((r) => r.category)).toEqual(["facility"]);
  });

  it("sesi member untuk ditautkan", async () => {
    const s = await memberSessionsForComplaint(branchId, customerId);
    expect(s.map((x) => [x.id, x.coach_id])).toEqual([[sessionId, coachId]]);
  });
});
