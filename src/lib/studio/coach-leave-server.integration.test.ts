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
  getCoachLeaveApprovers,
  listProgramDirectors,
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

    const hrisEmp = await createEmployee(pdHrisLeave);
    await query(
      `INSERT INTO hris.leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1, 'annual', CURRENT_DATE - 1, CURRENT_DATE + 1, 3, 'A9 test', 'approved')`,
      [hrisEmp]
    );
    const coachEmp = await createEmployee(pdTimeOff);
    const coach = await query<{ id: string }>(
      `INSERT INTO studio.coaches (company_id, branch_id, full_name, employee_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [branchId, pdTimeOff.name, coachEmp]
    );
    await query(
      `INSERT INTO studio.coach_time_off (company_id, branch_id, coach_id, date_from, date_to, reason)
       VALUES ($1, $1, $2, CURRENT_DATE, CURRENT_DATE, 'A9 test')`,
      [branchId, coach[0].id]
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.settings WHERE branch_id = $1`, [branchId]);
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
});
