/**
 * Test integrasi alur pengganti coach (EPIC-067 T-067-A4) terhadap Postgres
 * sungguhan. Menulis fixture lalu menghapusnya, jadi HANYA jalan bila
 * DATABASE_URL menunjuk database *_test. Nomor HP fixture sengaja tidak valid
 * supaya tidak ada WA yang terkirim.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  applyCoversOnApproval,
  assignSubstitute,
  expireStaleRequests,
  getCoachLeaveContext,
  listIncomingRequests,
  listLeaveCovers,
  listPendingCoachLeaves,
  markCoverCancelClass,
  requestSubstitute,
  respondToSubstituteRequest,
  suggestSubstitutes,
  syncLeaveCovers,
} from "./coach-cover-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const tag = branchId.slice(0, 8);
const userIds: string[] = [];
const employeeIds: string[] = [];
let leaveId = "";
const coach: Record<string, string> = {};
const sessions: Record<string, string> = {};
let pdUser = "";
let adminUser = "";

async function user(name: string, role: string): Promise<string> {
  const id = randomUUID();
  await query(`INSERT INTO auth.users (id, email, password_hash) VALUES ($1, $2, 'x')`, [id, `${id}@a4.test`]);
  await query(`INSERT INTO configuration.users (id, full_name, email, role, status) VALUES ($1, $2, $3, $4, 'active')`, [id, `A4 ${name} ${tag}`, `${id}@a4.test`, role]);
  userIds.push(id);
  return id;
}

async function coachFor(key: string, withUser = false): Promise<void> {
  const uid = withUser ? await user(key, "employee") : null;
  const emp = randomUUID();
  await query(
    `INSERT INTO hris.employees (id, user_id, full_name, nip, email, phone, join_date) VALUES ($1, $2, $3, $4, $5, '-', CURRENT_DATE)`,
    [emp, uid, `A4 ${key} ${tag}`, `A4-${emp.slice(0, 12)}`, `${emp}@a4.test`]
  );
  employeeIds.push(emp);
  const r = await query<{ id: string }>(
    `INSERT INTO studio.coaches (company_id, branch_id, full_name, employee_id) VALUES ($1, $1, $2, $3) RETURNING id`,
    [branchId, `A4 ${key} ${tag}`, emp]
  );
  coach[key] = r[0].id;
}

async function session(key: string, programId: string, date: string, start: string, coachKey: string) {
  const r = await query<{ id: string }>(
    `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id)
     VALUES ($1, $1, $2, $3::time, $3::time + interval '1 hour', $4, 10, $5) RETURNING id`,
    [branchId, date, start, programId, coach[coachKey]]
  );
  sessions[key] = r[0].id;
}

const coverFor = async (sessionKey: string) => (await listLeaveCovers(leaveId)).find((c) => c.session_id === sessions[sessionKey])!;

describe.skipIf(!IS_TEST_DB)("alur pengganti coach (DB)", () => {
  beforeAll(async () => {
    pdUser = await user("pd", "program_director");
    adminUser = await user("admin", "admin");
    await coachFor("pras", true);
    await coachFor("rara");
    await coachFor("budi");
    await coachFor("cuti");
    const prog = async (code: string, kind: string) =>
      (await query<{ id: string }>(
        `INSERT INTO studio.programs (company_id, branch_id, code, name, kind) VALUES ($1, $1, $2, $3, $4) RETURNING id`,
        [branchId, `${code}-${tag}`, `A4 ${code}`, kind]
      ))[0].id;
    const cls = await prog("CLS", "class");
    const pt = await prog("PT", "pt");
    await query(`INSERT INTO studio.coach_programs (coach_id, program_id, branch_id) VALUES ($1, $2, $3)`, [coach.rara, pt, branchId]);

    await session("mon", cls, "2026-11-02", "07:00", "pras");
    await session("tue_pt", pt, "2026-11-03", "18:00", "pras");
    await session("wed", cls, "2026-11-04", "07:00", "pras");
    await session("budi_mon", cls, "2026-11-02", "07:30", "budi"); // bentrok dengan "mon"
    await query(
      `INSERT INTO studio.coach_time_off (company_id, branch_id, coach_id, date_from, date_to, reason) VALUES ($1, $1, $2, '2026-11-01', '2026-11-05', 'A4')`,
      [branchId, coach.cuti]
    );

    const prasEmp = employeeIds[0];
    leaveId = (await query<{ id: string }>(
      `INSERT INTO hris.leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1, 'annual', '2026-11-02', '2026-11-04', 3, 'A4 test cuti', 'pending') RETURNING id`,
      [prasEmp]
    ))[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.coach_leave_covers WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.class_sessions WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM hris.leaves WHERE employee_id = ANY($1::uuid[])`, [employeeIds]);
    await query(`DELETE FROM hris.employees WHERE id = ANY($1::uuid[])`, [employeeIds]);
    await query(`DELETE FROM configuration.wa_notif_log WHERE notif_type = 'coach_cover' AND message LIKE $1`, [`%${tag}%`]);
    await query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [userIds]);
  });

  it("sinkron: satu baris open per sesi terjadwal coach di rentang cuti", async () => {
    const ctx = (await getCoachLeaveContext(leaveId))!;
    expect(ctx).toMatchObject({ coachId: coach.pras, branchId, status: "pending" });
    await syncLeaveCovers(ctx);
    const covers = await listLeaveCovers(leaveId);
    expect(covers.map((c) => [c.session_date, c.program_kind, c.status])).toEqual([
      ["2026-11-02", "class", "open"],
      ["2026-11-03", "pt", "open"],
      ["2026-11-04", "class", "open"],
    ]);
  });

  it("saran: buang yang bentrok & cuti; Personal Training hanya coach program itu", async () => {
    const mon = await suggestSubstitutes(await coverFor("mon"));
    expect(mon.map((c) => c.coach_id)).toEqual([coach.rara]);
    const pt = await suggestSubstitutes(await coverFor("tue_pt"));
    expect(pt.map((c) => c.coach_id)).toEqual([coach.rara]);
    const wed = await suggestSubstitutes(await coverFor("wed"));
    expect(wed.map((c) => c.coach_id).sort()).toEqual([coach.budi, coach.rara].sort());
  });

  it("minta → tolak → kembali open dengan catatan; minta lagi → terima", async () => {
    const mon = await coverFor("mon");
    await expect(requestSubstitute(mon.id, coach.pras, coach.budi)).rejects.toMatchObject({ status: 409 });
    await requestSubstitute(mon.id, coach.pras, coach.rara);
    expect((await listIncomingRequests(coach.rara)).map((c) => c.id)).toContain(mon.id);
    await expect(requestSubstitute(mon.id, coach.pras, coach.rara)).rejects.toMatchObject({ status: 409 });

    await respondToSubstituteRequest(mon.id, coach.rara, false);
    expect(await coverFor("mon")).toMatchObject({ status: "open", substitute_coach_id: null });
    expect((await coverFor("mon")).note).toContain("Ditolak");

    await requestSubstitute(mon.id, coach.pras, coach.rara);
    await respondToSubstituteRequest(mon.id, coach.rara, true);
    expect(await coverFor("mon")).toMatchObject({ status: "accepted", substitute_coach_id: coach.rara });
  });

  it("pengganti yang sudah menerima Senin 07.00 tetap disarankan untuk sesi Rabu (tidak bentrok)", async () => {
    const wed = await suggestSubstitutes(await coverFor("wed"));
    expect(wed.map((c) => c.coach_id)).toContain(coach.rara);
  });

  it("permintaan lewat batas waktu kembali open", async () => {
    const pt = await coverFor("tue_pt");
    await requestSubstitute(pt.id, coach.pras, coach.rara);
    await query(`UPDATE studio.coach_leave_covers SET respond_by = now() - interval '1 minute' WHERE id = $1`, [pt.id]);
    expect(await expireStaleRequests()).toBeGreaterThanOrEqual(1);
    expect((await coverFor("tue_pt")).status).toBe("open");
    await expect(respondToSubstituteRequest(pt.id, coach.rara, true)).rejects.toMatchObject({ status: 409 });
  });

  it("hanya Program Director yang menunjuk / membatalkan; antrean menandai cuti ini", async () => {
    const pt = await coverFor("tue_pt");
    await expect(assignSubstitute(pt.id, branchId, { id: adminUser, role: "admin" }, coach.rara)).rejects.toMatchObject({ status: 403 });
    await assignSubstitute(pt.id, branchId, { id: pdUser, role: "program_director" }, coach.rara);
    expect(await coverFor("tue_pt")).toMatchObject({ status: "assigned", substitute_coach_id: coach.rara });

    const queue = await listPendingCoachLeaves(branchId);
    expect(queue.map((q) => q.leaveId)).toEqual([leaveId]);
    expect(queue[0].covers.map((c) => c.status)).toEqual(["accepted", "assigned", "open"]);
  });

  it("persetujuan ditolak selama masih ada sesi open; setelah tertangani → coach diganti & sesi batal", async () => {
    await expect(withTransaction((c) => applyCoversOnApproval(c, leaveId))).rejects.toMatchObject({ status: 409 });

    const wed = await coverFor("wed");
    await markCoverCancelClass(wed.id, branchId, { id: pdUser, role: "program_director" }, "Tidak ada pengganti");
    const applied = await withTransaction((c) => applyCoversOnApproval(c, leaveId));
    expect(applied.swapped).toBe(2);
    expect(applied.swappedSessions.sort()).toEqual([sessions.mon, sessions.tue_pt].sort());
    expect(applied.cancelled).toEqual([{ sessionId: sessions.wed, reason: "Tidak ada pengganti" }]);

    const mon = await queryOne<{ coach_id: string; original_coach_id: string }>(
      `SELECT coach_id, original_coach_id FROM studio.class_sessions WHERE id = $1`, [sessions.mon]
    );
    expect(mon).toEqual({ coach_id: coach.rara, original_coach_id: coach.pras });
    const w = await queryOne<{ status: string; cancel_reason: string }>(`SELECT status, cancel_reason FROM studio.class_sessions WHERE id = $1`, [sessions.wed]);
    expect(w).toEqual({ status: "cancelled", cancel_reason: "Tidak ada pengganti" });
    expect((await listLeaveCovers(leaveId)).every((c) => c.applied_at)).toBe(true);
  });
});
