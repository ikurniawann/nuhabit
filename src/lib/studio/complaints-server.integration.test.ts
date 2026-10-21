/**
 * Test integrasi tiket keluhan (EPIC-067 T-067-B1). HANYA jalan bila
 * DATABASE_URL menunjuk database *_test; fixture dihapus sesudahnya.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, queryOne } from "@/lib/db";
import {
  addComplaintNote,
  assignComplaint,
  createComplaint,
  createComplaintFromWa,
  getComplaint,
  listComplaints,
  loadComplaintSettings,
  memberSessionsForComplaint,
  saveComplaintSettings,
  transitionComplaint,
} from "./complaints-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const venue = { companyId: branchId, branchId };
const tag = branchId.slice(0, 8);
let userId = "";
let staffB = "";
let coachId = "";
let customerId = "";
let sessionId = "";
let convId = "";
const now = new Date("2026-10-22T03:00:00Z");

describe.skipIf(!IS_TEST_DB)("tiket keluhan (DB)", () => {
  beforeAll(async () => {
    const mkUser = async (name: string) => {
      const id = randomUUID();
      await query(`INSERT INTO auth.users (id, email, password_hash) VALUES ($1, $2, 'x')`, [id, `${id}@b2.test`]);
      await query(`INSERT INTO configuration.users (id, full_name, email, role, status) VALUES ($1, $2, $3, 'admin', 'active')`, [id, `${name} ${tag}`, `${id}@b2.test`]);
      return id;
    };
    userId = await mkUser("Staf A");
    staffB = await mkUser("Staf B");
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
    await query(`DELETE FROM studio.settings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.complaints WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [[userId, staffB]]);
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

  it("daftar: belum ditutup dulu, prioritas tertinggi dulu; filter kategori & pencarian", async () => {
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

  it("pengaturan: batas waktu & PIC default berlaku untuk tiket baru", async () => {
    await expect(saveComplaintSettings(branchId, { default_assignees: { billing: randomUUID() } }, userId)).rejects.toMatchObject({ status: 400 });
    await saveComplaintSettings(branchId, { sla_rules: { injury: { respond_hours: 1, resolve_hours: 12 } }, default_assignees: { billing: staffB } }, userId);
    const st = await loadComplaintSettings(branchId);
    expect(st.sla_rules.injury).toEqual({ respond_hours: 1, resolve_hours: 12 });
    expect(st.sla_rules.coach).toEqual({ respond_hours: 24, resolve_hours: 72 });

    const inj = await createComplaint(venue, userId, { source: "front_desk", category: "injury", description: "Pergelangan kaki terkilir", contact_name: "Tamu" }, now);
    expect(new Date((await getComplaint(branchId, inj.id))!.respond_by!).toISOString()).toBe("2026-10-22T04:00:00.000Z");
    const bill = await createComplaint(venue, userId, { source: "front_desk", category: "billing", description: "Struk tidak dikirim", contact_name: "Tamu" }, now);
    const d = (await getComplaint(branchId, bill.id))!;
    expect(d.assignee_user_id).toBe(staffB);
    expect(d.events.map((e) => e.body)).toContain(`PIC otomatis: Staf B ${tag}`);
  });

  it("alur: mulai tangani → selesai (wajib catatan) → buka lagi (wajib alasan) → selesai → dikonfirmasi", async () => {
    const t = await createComplaint(venue, userId, { source: "front_desk", category: "facility", title: "Loker 12 rusak", contact_name: "Tamu" }, now);
    await expect(transitionComplaint(branchId, t.id, userId, "confirmed")).rejects.toMatchObject({ status: 409 });

    await transitionComplaint(branchId, t.id, userId, "in_progress");
    let d = (await getComplaint(branchId, t.id))!;
    expect(d.status).toBe("in_progress");
    expect(d.first_response_at).not.toBeNull();
    expect(d.assignee_user_id).toBe(userId); // diambil otomatis

    await expect(transitionComplaint(branchId, t.id, userId, "resolved", "  ")).rejects.toMatchObject({ status: 400 });
    await transitionComplaint(branchId, t.id, userId, "resolved", "Kunci loker diganti");
    expect((await getComplaint(branchId, t.id))!.resolved_at).not.toBeNull();
    await expect(transitionComplaint(branchId, t.id, userId, "in_progress")).rejects.toMatchObject({ status: 400 });
    await transitionComplaint(branchId, t.id, userId, "in_progress", "Member bilang masih macet");
    expect((await getComplaint(branchId, t.id))!.resolved_at).toBeNull();
    await transitionComplaint(branchId, t.id, userId, "resolved", "Engsel diganti");
    await transitionComplaint(branchId, t.id, userId, "confirmed");

    await expect(assignComplaint(branchId, t.id, userId, staffB)).rejects.toMatchObject({ status: 409 });
    await addComplaintNote(branchId, t.id, userId, "Sudah dicek ulang besoknya");
    d = (await getComplaint(branchId, t.id))!;
    expect(d.status).toBe("confirmed");
    expect(d.events.map((e) => `${e.kind}:${e.to_status ?? ""}`)).toEqual([
      "created:received", "status:in_progress", "assign:", "status:resolved", "status:in_progress", "status:resolved", "status:confirmed", "note:",
    ]);
    expect(d.events.find((e) => e.to_status === "resolved")?.body).toBe("Kunci loker diganti");
  });

  it("PIC: hanya user backoffice aktif; filter 'ditugaskan ke saya'", async () => {
    const t = await createComplaint(venue, userId, { source: "front_desk", category: "class", title: "Kelas penuh terus", contact_name: "Tamu" }, now);
    await expect(assignComplaint(branchId, t.id, userId, randomUUID())).rejects.toMatchObject({ status: 400 });
    await assignComplaint(branchId, t.id, userId, staffB);
    const mine = await listComplaints(branchId, { assigneeUserId: staffB });
    expect(mine.map((r) => r.title)).toEqual(expect.arrayContaining(["Kelas penuh terus"]));
    await assignComplaint(branchId, t.id, userId, null);
    expect((await getComplaint(branchId, t.id))!.events.map((e) => e.body)).toEqual(expect.arrayContaining([`PIC: Staf B ${tag}`, "PIC dilepas"]));
  });

  it("filter 'belum ditutup' memuat tiket Selesai yang menunggu konfirmasi, tidak memuat yang dikonfirmasi", async () => {
    const open = await listComplaints(branchId, { status: "open" });
    expect(open.some((r) => r.title === "Loker 12 rusak")).toBe(false); // sudah dikonfirmasi
    const t = await createComplaint(venue, userId, { source: "front_desk", category: "other", title: "Musik terlalu keras", contact_name: "Tamu" }, now);
    await transitionComplaint(branchId, t.id, userId, "resolved", "Volume diturunkan");
    const after = await listComplaints(branchId, { status: "open" });
    const idx = after.findIndex((r) => r.id === t.id);
    expect(idx).toBeGreaterThan(-1);
    expect(after.slice(idx + 1).every((r) => r.status === "resolved")).toBe(true);
  });
});
