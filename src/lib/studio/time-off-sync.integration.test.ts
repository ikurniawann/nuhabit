/**
 * Test integrasi sinkron cuti coach → time-off (EPIC-067 T-067-A5). HANYA
 * jalan bila DATABASE_URL menunjuk database *_test; fixture dihapus sesudahnya.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, withTransaction } from "@/lib/db";
import { getCoachLeaveContext, removeLeaveTimeOff, syncLeaveTimeOff } from "./coach-cover-server";
import { assertCoachNotOnTimeOff } from "./conflicts";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const tag = branchId.slice(0, 8);
let employeeId = "";
let coachId = "";
let leaveId = "";

describe.skipIf(!IS_TEST_DB)("sinkron cuti coach → time-off (DB)", () => {
  beforeAll(async () => {
    employeeId = (await query<{ id: string }>(
      `INSERT INTO hris.employees (full_name, nip, email, phone, join_date) VALUES ($1, $2, $3, '-', CURRENT_DATE) RETURNING id`,
      [`Coach A5 ${tag}`, `A5-${tag}`, `${tag}@a5.test`]
    ))[0].id;
    coachId = (await query<{ id: string }>(
      `INSERT INTO studio.coaches (company_id, branch_id, full_name, employee_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [branchId, `Coach A5 ${tag}`, employeeId]
    ))[0].id;
    leaveId = (await query<{ id: string }>(
      `INSERT INTO hris.leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1, 'unpaid', '2026-11-09', '2026-11-11', 3, 'A5 test', 'approved') RETURNING id`,
      [employeeId]
    ))[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.coach_time_off WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM hris.leaves WHERE id = $1`, [leaveId]);
    await query(`DELETE FROM hris.employees WHERE id = $1`, [employeeId]);
  });

  it("cuti disetujui → satu time-off bertaut cuti (idempoten)", async () => {
    const ctx = (await getCoachLeaveContext(leaveId))!;
    await withTransaction((c) => syncLeaveTimeOff(c, ctx, "Cuti: Cuti Tanpa Upah"));
    await withTransaction((c) => syncLeaveTimeOff(c, ctx, "Cuti: Cuti Tanpa Upah"));
    const rows = await query<{ date_from: string; date_to: string; reason: string }>(
      `SELECT date_from::text AS date_from, date_to::text AS date_to, reason FROM studio.coach_time_off WHERE leave_id = $1`,
      [leaveId]
    );
    expect(rows).toEqual([{ date_from: "2026-11-09", date_to: "2026-11-11", reason: "Cuti: Cuti Tanpa Upah" }]);
  });

  it("menjadwalkan coach di tanggal cuti ditolak; di luar rentang boleh", async () => {
    await expect(assertCoachNotOnTimeOff(branchId, coachId, "2026-11-10")).rejects.toMatchObject({ status: 409 });
    await expect(assertCoachNotOnTimeOff(branchId, coachId, "2026-11-12")).resolves.toBeUndefined();
    await expect(assertCoachNotOnTimeOff(branchId, null, "2026-11-10")).resolves.toBeUndefined();
  });

  it("cuti dibatalkan → time-off hasil sinkron hilang, time-off manual tetap", async () => {
    await query(
      `INSERT INTO studio.coach_time_off (company_id, branch_id, coach_id, date_from, date_to, reason) VALUES ($1, $1, $2, '2026-11-20', '2026-11-20', 'Manual')`,
      [branchId, coachId]
    );
    await removeLeaveTimeOff(leaveId);
    const rows = await query<{ reason: string }>(`SELECT reason FROM studio.coach_time_off WHERE branch_id = $1`, [branchId]);
    expect(rows.map((r) => r.reason)).toEqual(["Manual"]);
    await expect(assertCoachNotOnTimeOff(branchId, coachId, "2026-11-10")).resolves.toBeUndefined();
  });
});
