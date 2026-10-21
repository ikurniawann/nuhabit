/**
 * Test integrasi approver cuti coach (EPIC-067 T-067-A9) terhadap Postgres
 * sungguhan. Menulis fixture lalu menghapusnya, jadi HANYA jalan bila
 * DATABASE_URL menunjuk database *_test (mis. nuhabit_test) — tidak pernah ke
 * DB `nuhabit` yang berisi data owner.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import {
  assertCanDecideCoachLeave,
  createBlackout,
  deleteBlackout,
  evaluateCoachLeaveNotice,
  getCoachLeaveApprovers,
  leaveBlackoutConflicts,
  listCoachLeaves,
  listCoachSessionsInRange,
  listProgramDirectors,
  listUpcomingBlackouts,
  loadCoachLeaveSettings,
  saveCoachLeaveSettings,
} from "./coach-leave-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const tag = branchId.slice(0, 8);
const user = (key: string) => ({ id: randomUUID(), name: `A9 ${key} ${tag}` });
const pdColumn = user("pd-kolom");
const pdIam = user("pd-iam");
const pdHrisLeave = user("pd-cuti-hris");
const pdTimeOff = user("pd-timeoff");
const pdInactive = user("pd-nonaktif");
const backup = user("cadangan");
const plainAdmin = user("admin");
const allUsers = [pdColumn, pdIam, pdHrisLeave, pdTimeOff, pdInactive, backup, plainAdmin];
const employeeIds: string[] = [];
let hrisEmp = "";
let coachEmp = "";
let coachId = "";

async function createUser(u: { id: string; name: string }, role: string, status = "active") {
  await query(`INSERT INTO auth.users (id, email, password_hash) VALUES ($1, $2, 'x')`, [u.id, `${u.id}@a9.test`]);
  await query(`INSERT INTO configuration.users (id, full_name, email, role, status) VALUES ($1, $2, $3, $4, $5)`, [
    u.id, u.name, `${u.id}@a9.test`, role, status,
  ]);
}

async function createEmployee(u: { id: string; name: string }): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO hris.employees (id, user_id, full_name, nip, email, phone, join_date)
     VALUES ($1, $2, $3, $4, $5, '0800', CURRENT_DATE)`,
    [id, u.id, u.name, `A9-${id.slice(0, 12)}`, `${u.id}@a9.test`]
  );
  employeeIds.push(id);
  return id;
}

describe.skipIf(!IS_TEST_DB)("coach leave approvers (DB)", () => {
  beforeAll(async () => {
    await createUser(pdColumn, "program_director");
    await createUser(pdIam, "admin");
    await query(
      `INSERT INTO iam.user_roles (user_id, role_id) SELECT $1, id FROM iam.roles WHERE code = 'program_director'`,
      [pdIam.id]
    );
    await createUser(pdHrisLeave, "program_director");
    await createUser(pdTimeOff, "program_director");
    await createUser(pdInactive, "program_director", "inactive");
    await createUser(backup, "admin");
    await createUser(plainAdmin, "admin");

    hrisEmp = await createEmployee(pdHrisLeave);
    await query(
      `INSERT INTO hris.leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1, 'annual', CURRENT_DATE - 1, CURRENT_DATE + 1, 3, 'A9 test', 'approved')`,
      [hrisEmp]
    );
    coachEmp = await createEmployee(pdTimeOff);
    const coach = await query<{ id: string }>(
      `INSERT INTO studio.coaches (company_id, branch_id, full_name, employee_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [branchId, pdTimeOff.name, coachEmp]
    );
    coachId = coach[0].id;
    await query(
      `INSERT INTO studio.coach_time_off (company_id, branch_id, coach_id, date_from, date_to, reason)
       VALUES ($1, $1, $2, CURRENT_DATE, CURRENT_DATE, 'A9 test')`,
      [branchId, coach[0].id]
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.settings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coach_leave_blackouts WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.class_sessions WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM hris.leaves WHERE employee_id = ANY($1::uuid[])`, [employeeIds]);
    await query(`DELETE FROM hris.employees WHERE id = ANY($1::uuid[])`, [employeeIds]);
    await query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [allUsers.map((u) => u.id)]);
  });

  it("mengenali Program Director dari kolom role dan iam.user_roles, menandai yang sedang cuti", async () => {
    const list = await listProgramDirectors(branchId);
    const mine = new Map(list.filter((p) => allUsers.some((u) => u.id === p.userId)).map((p) => [p.userId, p.onLeave]));
    expect(Object.fromEntries(mine)).toEqual({
      [pdColumn.id]: false,
      [pdIam.id]: false,
      [pdHrisLeave.id]: true,
      [pdTimeOff.id]: true,
    });
  });

  it("menyimpan approver cadangan dan hanya memakai Program Director aktif sebagai approver", async () => {
    expect((await loadCoachLeaveSettings(branchId)).backup_approver_user_id).toBeNull();
    await saveCoachLeaveSettings(branchId, { backup_approver_user_id: backup.id }, plainAdmin.id);
    const state = await getCoachLeaveApprovers(branchId);
    expect(state.backup?.userId).toBe(backup.id);
    expect(state.resolved.source).toBe("program_director");
    const ids = state.resolved.approvers.map((a) => a.userId);
    expect(ids).toEqual(expect.arrayContaining([pdColumn.id, pdIam.id]));
    expect(ids).not.toContain(pdHrisLeave.id);
    expect(ids).not.toContain(pdTimeOff.id);
  });

  it("menolak admin biasa dan pengajuan sendiri, mengizinkan Program Director aktif", async () => {
    await expect(assertCanDecideCoachLeave(branchId, { id: pdColumn.id, role: "program_director" })).resolves.toBeUndefined();
    await expect(assertCanDecideCoachLeave(branchId, { id: plainAdmin.id, role: "admin" })).rejects.toMatchObject({ status: 403 });
    await expect(
      assertCanDecideCoachLeave(branchId, { id: pdColumn.id, role: "program_director" }, pdColumn.id)
    ).rejects.toMatchObject({ status: 403 });
  });

  it("aturan H-N hanya untuk karyawan coach, memakai pengaturan venue coach (sebagian digabung default)", async () => {
    // 21 Okt 2026 10.00 WIB
    const now = new Date("2026-10-21T03:00:00Z");
    expect(await evaluateCoachLeaveNotice(hrisEmp, "annual", "2026-10-22", "2026-10-22", now)).toBeNull();

    const before = await evaluateCoachLeaveNotice(coachEmp, "annual", "2026-10-24", "2026-10-24", now);
    expect(before).toMatchObject({ branchId, rule: { min_days: 7 }, evaluation: { ok: false, earliestStart: "2026-10-28" } });

    await saveCoachLeaveSettings(branchId, { notice_rules: { annual: { min_days: 2, allow_short_notice: false } } }, plainAdmin.id);
    const after = await evaluateCoachLeaveNotice(coachEmp, "annual", "2026-10-24", "2026-10-24", now);
    expect(after?.evaluation).toEqual({ ok: true, shortNotice: false, noticeDays: 3 });

    const settings = await loadCoachLeaveSettings(branchId);
    expect(settings.notice_rules.sick).toEqual({ min_days: 1, allow_short_notice: true, blackout: false });
    expect(settings.backup_approver_user_id).toBe(backup.id);

    const sickToday = await evaluateCoachLeaveNotice(coachEmp, "sick", "2026-10-21", "2026-10-21", now);
    expect(sickToday?.evaluation).toEqual({ ok: true, shortNotice: true, noticeDays: 0 });
  });

  it("sesi terdampak: hanya sesi terjadwal coach ini di rentang, kelas & Personal Training, dengan jumlah booking", async () => {
    const program = async (code: string, kind: string) =>
      (await query<{ id: string }>(
        `INSERT INTO studio.programs (company_id, branch_id, code, name, kind) VALUES ($1, $1, $2, $3, $4) RETURNING id`,
        [branchId, `${code}-${tag}`, `A3 ${code}`, kind]
      ))[0].id;
    const cls = await program("CLS", "class");
    const pt = await program("PT", "pt");
    const session = (programId: string, date: string, time: string, status = "scheduled", coach: string | null = coachId) =>
      query(
        `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id, status)
         VALUES ($1, $1, $2, $3::time, $3::time + interval '1 hour', $4, 10, $5, $6)`,
        [branchId, date, time, programId, coach, status]
      );
    await session(cls, "2026-11-02", "07:00");
    await session(pt, "2026-11-03", "18:00");
    await session(cls, "2026-11-03", "06:00", "cancelled");
    await session(cls, "2026-11-04", "07:00", "scheduled", null);
    await session(cls, "2026-11-10", "07:00");

    const list = await listCoachSessionsInRange(coachId, "2026-11-02", "2026-11-04");
    expect(list.map((s) => [s.session_date, s.start_time, s.program_kind, s.booked_count])).toEqual([
      ["2026-11-02", "07:00", "class", 0],
      ["2026-11-03", "18:00", "pt", 0],
    ]);
  });

  it("riwayat cuti coach diambil lewat karyawan yang tertaut, dengan tanggal teks & flag mendadak", async () => {
    await query(
      `INSERT INTO hris.leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, is_short_notice, notice_days)
       VALUES ($1, 'sick', '2026-10-21', '2026-10-21', 1, 'A3 test sakit', 'pending', true, 0)`,
      [coachEmp]
    );
    const rows = await listCoachLeaves(coachId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ leave_type: "sick", start_date: "2026-10-21", is_short_notice: true, notice_days: 0 });
  });

  it("tanggal blackout: konflik per jenis cuti, cuti yang sudah ada dilaporkan, daftar mendatang, hapus", async () => {
    const now = new Date("2026-10-21T03:00:00Z");
    await query(
      `INSERT INTO hris.leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1, 'annual', '2026-11-16', '2026-11-17', 2, 'A2 sudah disetujui', 'approved')`,
      [coachEmp]
    );
    const venue = { companyId: branchId, branchId };
    const { id, overlapping } = await createBlackout(venue, plainAdmin.id, { date_from: "2026-11-14", date_to: "2026-11-16", reason: " Hyrox Jakarta " });
    expect(overlapping.map((o) => [o.leave_type, o.start_date, o.status])).toEqual([["annual", "2026-11-16", "approved"]]);
    await query(
      `INSERT INTO studio.coach_leave_blackouts (company_id, branch_id, date_from, date_to, reason) VALUES ($1, $1, '2026-10-01', '2026-10-02', 'lewat')`,
      [branchId]
    );

    const upcoming = await listUpcomingBlackouts(branchId, now);
    expect(upcoming.map((b) => [b.date_from, b.date_to, b.reason, b.created_by_name])).toEqual([
      ["2026-11-14", "2026-11-16", "Hyrox Jakarta", plainAdmin.name],
    ]);

    const annual = await evaluateCoachLeaveNotice(coachEmp, "annual", "2026-11-10", "2026-11-14", now);
    expect(annual?.blackouts.map((b) => b.id)).toEqual([id]);
    expect((await evaluateCoachLeaveNotice(coachEmp, "annual", "2026-11-17", "2026-11-18", now))?.blackouts).toEqual([]);
    expect((await evaluateCoachLeaveNotice(coachEmp, "sick", "2026-11-15", "2026-11-15", now))?.blackouts).toEqual([]);

    // Ubah satu kolom saja: kolom lain jenis cuti itu tetap.
    await saveCoachLeaveSettings(branchId, { notice_rules: { sick: { blackout: true } } }, plainAdmin.id);
    expect((await loadCoachLeaveSettings(branchId)).notice_rules.sick).toEqual({ min_days: 1, allow_short_notice: true, blackout: true });
    expect(await leaveBlackoutConflicts({ branchId, leaveType: "sick", startDate: "2026-11-15", endDate: "2026-11-15" })).toHaveLength(1);

    await deleteBlackout(branchId, id);
    expect(await leaveBlackoutConflicts({ branchId, leaveType: "annual", startDate: "2026-11-14", endDate: "2026-11-16" })).toEqual([]);
    await expect(deleteBlackout(branchId, id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteBlackout(randomUUID(), upcoming[0].id)).rejects.toMatchObject({ status: 404 });
  });
});
