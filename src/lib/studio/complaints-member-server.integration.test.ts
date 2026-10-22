/**
 * Test integrasi laporan & masukan dari Member App (EPIC-067 T-067-B4).
 * HANYA jalan bila DATABASE_URL menunjuk database *_test; fixture dihapus
 * sesudahnya. WA staf & notifikasi owner di-mock.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const owner: { dedupKey: string; message: string }[] = [];
const staffWa: { key: string; message: string }[] = [];
vi.mock("@/lib/wa/notifications-sender", () => ({
  sendOwnerNotification: vi.fn(async (i: { dedupKey: string; message: string }) => {
    owner.push(i);
    return { sent: true, recipients: 1 };
  }),
}));
vi.mock("@/lib/studio/staff-wa", () => ({
  sendStaffWa: vi.fn(async (_t: string, key: string, phone: string | null, message: string) => {
    staffWa.push({ key, message });
    return Boolean(phone);
  }),
}));

import { query, queryOne } from "@/lib/db";
import type { BookingActor } from "./booking-server";
import { createMemberReport, listMemberReports, memberRecentSessions, respondToResolution } from "./complaints-member-server";
import { createComplaint, saveComplaintSettings, transitionComplaint } from "./complaints-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const tag = branchId.slice(0, 8);
const actor: BookingActor = { companyId: branchId, branchId, actorId: null, staff: false };
let customerId = "";
let otherCustomer = "";
let coachId = "";
let pastSession = "";
let futureSession = "";
let picId = "";

describe.skipIf(!IS_TEST_DB)("laporan dari Member App (DB)", () => {
  beforeAll(async () => {
    picId = randomUUID();
    await query(`INSERT INTO auth.users (id, email, password_hash) VALUES ($1, $2, 'x')`, [picId, `${picId}@b4.test`]);
    await query(`INSERT INTO configuration.users (id, full_name, email, role, status) VALUES ($1, $2, $3, 'admin', 'active')`, [picId, `PIC B4 ${tag}`, `${picId}@b4.test`]);
    await query(`INSERT INTO hris.employees (user_id, full_name, nip, email, phone, join_date) VALUES ($1, $2, $3, $4, '081277700081', CURRENT_DATE)`, [picId, `PIC B4 ${tag}`, `B4-${tag}`, `${tag}@b4emp.test`]);
    coachId = (await query<{ id: string }>(`INSERT INTO studio.coaches (company_id, branch_id, full_name) VALUES ($1, $1, $2) RETURNING id`, [branchId, `Coach B4 ${tag}`]))[0].id;
    customerId = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, '081277700082') RETURNING id`, [`Maya B4 ${tag}`]))[0].id;
    otherCustomer = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, '081277700083') RETURNING id`, [`Nana B4 ${tag}`]))[0].id;
    const program = (await query<{ id: string }>(`INSERT INTO studio.programs (company_id, branch_id, code, name, kind) VALUES ($1, $1, $2, 'Hyrox Engine', 'class') RETURNING id`, [branchId, `B4-${tag}`]))[0].id;
    const mkSession = async (offsetDays: number) =>
      (await query<{ id: string }>(
        `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id)
         VALUES ($1, $1, (now() AT TIME ZONE 'Asia/Jakarta')::date + $2::int, '07:00', '08:00', $3, 10, $4) RETURNING id`,
        [branchId, offsetDays, program, coachId]
      ))[0].id;
    pastSession = await mkSession(-2);
    futureSession = await mkSession(2);
    for (const s of [pastSession, futureSession]) {
      await query(`INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status) VALUES ($1, $1, $2, $3, 'attended')`, [branchId, s, customerId]);
    }
    await saveComplaintSettings(branchId, { default_assignees: { facility: picId } }, picId);
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.complaints WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.settings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.bookings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.class_sessions WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM pos.pos_customers WHERE id = ANY($1::uuid[])`, [[customerId, otherCustomer]]);
    await query(`DELETE FROM hris.employees WHERE user_id = $1`, [picId]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [picId]);
  });

  it("sesi yang bisa ditautkan: hanya yang sudah lewat milik member", async () => {
    expect((await memberRecentSessions(branchId, customerId)).map((s) => s.id)).toEqual([pastSession]);
    expect(await memberRecentSessions(branchId, otherCustomer)).toEqual([]);
  });

  it("laporan cedera: tiket Member App, coach dari sesi, prioritas tinggi, Head Coach/Ops langsung dikabari", async () => {
    const r = await createMemberReport(actor, customerId, { kind: "complaint", category: "injury", message: "Lutut sakit setelah sled push", session_id: pastSession });
    const k = await queryOne<{ source: string; kind: string; priority: string; coach_id: string; contact_name: string; created_by: string | null; respond_by: string | null }>(
      `SELECT source, kind, priority, coach_id, contact_name, created_by, respond_by FROM studio.complaints WHERE id = $1`,
      [r.id]
    );
    expect(k).toMatchObject({ source: "member_app", kind: "complaint", priority: "high", coach_id: coachId, contact_name: `Maya B4 ${tag}`, created_by: null });
    expect(k?.respond_by).not.toBeNull();
    expect(owner).toHaveLength(1);
    expect(owner[0]).toMatchObject({ dedupKey: `complaint:${r.id}:new` });
    expect(owner[0].message).toContain("Laporan cedera dari Member App");
    await expect(
      createMemberReport(actor, customerId, { kind: "complaint", category: "class", message: "Kelas mulai telat sepuluh menit", session_id: futureSession })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("masukan: tanpa batas waktu & prioritas rendah; keluhan fasilitas ke PIC default", async () => {
    const fb = await createMemberReport(actor, customerId, { kind: "feedback", category: "coach", message: "Coach-nya keren, kelasnya seru sekali" });
    expect(await queryOne(`SELECT kind, priority, respond_by, resolve_by FROM studio.complaints WHERE id = $1`, [fb.id])).toEqual({
      kind: "feedback",
      priority: "low",
      respond_by: null,
      resolve_by: null,
    });
    staffWa.length = 0;
    await createMemberReport(actor, customerId, { kind: "complaint", category: "facility", message: "Shower ruang ganti pria mati" }, new Date("2026-10-22T05:00:00Z"));
    expect(staffWa.map((w) => w.key)).toEqual([expect.stringMatching(/:new:pic$/)]);
  });

  it("daftar member hanya tiket Member App miliknya; batas 5 laporan per 24 jam", async () => {
    await createComplaint({ companyId: branchId, branchId }, picId, { source: "front_desk", category: "billing", customer_id: customerId, title: "Catatan internal staf" });
    const mine = await listMemberReports(branchId, customerId);
    expect(mine.map((r) => [r.kind, r.category, r.status_label])).toEqual([
      ["complaint", "facility", "Received"],
      ["feedback", "coach", "Received"],
      ["complaint", "injury", "Received"],
    ]);
    expect(await listMemberReports(branchId, otherCustomer)).toEqual([]);
    await createMemberReport(actor, customerId, { kind: "feedback", category: "other", message: "Tambah jadwal malam ya" });
    await createMemberReport(actor, customerId, { kind: "feedback", category: "other", message: "Musiknya mantap sekali" });
    await expect(createMemberReport(actor, customerId, { kind: "feedback", category: "other", message: "Satu lagi masukan" })).rejects.toMatchObject({ status: 429 });
  });

  it("konfirmasi member: belum beres → dibuka lagi & PIC dikabari; beres → ditutup; bukan pemilik 404", async () => {
    const facility = (await listMemberReports(branchId, customerId)).find((r) => r.category === "facility")!;
    await expect(respondToResolution(branchId, customerId, facility.id, { resolved: true })).rejects.toMatchObject({ status: 409 });
    await transitionComplaint(branchId, facility.id, picId, "resolved", "Shower sudah diperbaiki teknisi");
    await expect(respondToResolution(branchId, otherCustomer, facility.id, { resolved: true })).rejects.toMatchObject({ status: 404 });

    staffWa.length = 0;
    await respondToResolution(branchId, customerId, facility.id, { resolved: false, comment: "Air panasnya masih mati" });
    expect(await queryOne(`SELECT status, resolved_at FROM studio.complaints WHERE id = $1`, [facility.id])).toEqual({ status: "in_progress", resolved_at: null });
    expect(staffWa[0].message).toContain("dibuka lagi oleh member");
    expect(staffWa[0].message).toContain("Air panasnya masih mati");

    await transitionComplaint(branchId, facility.id, picId, "resolved", "Water heater diganti");
    await respondToResolution(branchId, customerId, facility.id, { resolved: true });
    const done = await queryOne<{ status: string; confirmed_at: string | null }>(`SELECT status, confirmed_at FROM studio.complaints WHERE id = $1`, [facility.id]);
    expect(done?.status).toBe("confirmed");
    expect(done?.confirmed_at).not.toBeNull();
    const events = await query<{ body: string | null }>(`SELECT body FROM studio.complaint_events WHERE complaint_id = $1 AND kind = 'status' ORDER BY created_at`, [facility.id]);
    expect(events.map((e) => e.body)).toEqual([
      "Shower sudah diperbaiki teknisi",
      "Member: belum selesai — Air panasnya masih mati",
      "Water heater diganti",
      "Dikonfirmasi member lewat Member App",
    ]);
    expect((await listMemberReports(branchId, customerId)).find((r) => r.id === facility.id)?.status_label).toBe("Closed");
  });
});
