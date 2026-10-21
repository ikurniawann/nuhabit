/**
 * Test integrasi disiplin coach (EPIC-067 T-067-A8). HANYA jalan bila
 * DATABASE_URL menunjuk database *_test; fixture dihapus sesudahnya. WA di-mock.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const wa: string[] = [];
vi.mock("@/lib/studio/staff-wa", () => ({
  sendStaffWa: vi.fn(async (_t: string, _k: string, _p: string | null, message: string) => {
    wa.push(message);
    return true;
  }),
}));

import { query, queryOne } from "@/lib/db";
import { getCoachLeaveContext } from "./coach-cover-server";
import {
  decideWarning,
  listIncidents,
  listWarnings,
  periodDeductions,
  recordIncident,
  recordShortNoticeLeaveIncident,
  saveDisciplineRules,
  voidIncident,
} from "./coach-discipline-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const venue = { companyId: branchId, branchId };
const tag = branchId.slice(0, 8);
const users: string[] = [];
let pd = "";
let admin = "";
let coachUser = "";
let employeeId = "";
let coachId = "";
let leaveId = "";

const wibToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.parse(`${wibToday()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

async function mkUser(name: string, role: string) {
  const id = randomUUID();
  await query(`INSERT INTO auth.users (id, email, password_hash) VALUES ($1, $2, 'x')`, [id, `${id}@a8.test`]);
  await query(`INSERT INTO configuration.users (id, full_name, email, role, status) VALUES ($1, $2, $3, $4, 'active')`, [id, `${name} ${tag}`, `${id}@a8.test`, role]);
  users.push(id);
  return id;
}

describe.skipIf(!IS_TEST_DB)("disiplin coach (DB)", () => {
  beforeAll(async () => {
    pd = await mkUser("PD", "program_director");
    admin = await mkUser("Admin", "admin");
    coachUser = await mkUser("Coach", "employee");
    employeeId = (await query<{ id: string }>(
      `INSERT INTO hris.employees (user_id, full_name, nip, email, phone, join_date) VALUES ($1, $2, $3, $4, '-', CURRENT_DATE) RETURNING id`,
      [coachUser, `Coach A8 ${tag}`, `A8-${tag}`, `${tag}@a8emp.test`]
    ))[0].id;
    coachId = (await query<{ id: string }>(
      `INSERT INTO studio.coaches (company_id, branch_id, full_name, employee_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [branchId, `Coach A8 ${tag}`, employeeId]
    ))[0].id;
    leaveId = (await query<{ id: string }>(
      `INSERT INTO hris.leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, is_short_notice, notice_days)
       VALUES ($1, 'sick', $2, $2, 1, 'A8 test', 'approved', true, 0) RETURNING id`,
      [employeeId, daysAgo(2)]
    ))[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.settings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]); // cascade incidents & warnings
    await query(`DELETE FROM hris.leaves WHERE id = $1`, [leaveId]);
    await query(`DELETE FROM hris.employees WHERE id = $1`, [employeeId]);
    await query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [users]);
  });

  it("catat: potongan snapshot dari aturan; terlambat wajib menit; cuti mendadak sekali per cuti", async () => {
    await recordIncident(venue, admin, { coach_id: coachId, kind: "no_show", occurred_on: daysAgo(10), note: "Tidak datang kelas 07.00" });
    await expect(recordIncident(venue, admin, { coach_id: coachId, kind: "late", occurred_on: daysAgo(5) })).rejects.toMatchObject({ status: 400 });
    const ctx = (await getCoachLeaveContext(leaveId))!;
    await recordShortNoticeLeaveIncident(ctx, 0);
    await recordShortNoticeLeaveIncident(ctx, 0);
    const list = await listIncidents(branchId);
    expect(list.map((i) => [i.kind, i.deduction_percent])).toEqual([
      ["short_notice_leave", 5],
      ["no_show", 15],
    ]);
    expect(list[0].note).toBe("Cuti mendadak, diajukan H-0");
  });

  it("kejadian ke-3 dalam 90 hari → usulan SP1 + WA ke Program Director; tidak dobel", async () => {
    expect(await listWarnings(branchId)).toHaveLength(0);
    await recordIncident(venue, admin, { coach_id: coachId, kind: "late", occurred_on: daysAgo(1), minutes_late: 25 });
    await new Promise((r) => setTimeout(r, 200)); // notifikasi WA dikirim tanpa ditunggu
    const w = await listWarnings(branchId);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ level: 1, status: "proposed", incident_count: 3 });
    expect(w[0].incident_summary).toContain("Terlambat");
    expect(wa.some((m) => m.includes("Usulan SP1") && m.includes(`Coach A8 ${tag}`))).toBe(true);
  });

  it("hanya Program Director yang memutus; abaikan wajib alasan; terbitkan → kejadian berikutnya mengusulkan SP2", async () => {
    const [w] = await listWarnings(branchId);
    await expect(decideWarning(branchId, w.id, { id: admin, role: "admin" }, "issued")).rejects.toMatchObject({ status: 403 });
    await expect(decideWarning(branchId, w.id, { id: pd, role: "program_director" }, "dismissed", " ")).rejects.toMatchObject({ status: 400 });
    await decideWarning(branchId, w.id, { id: pd, role: "program_director" }, "issued");
    await expect(decideWarning(branchId, w.id, { id: pd, role: "program_director" }, "issued")).rejects.toMatchObject({ status: 409 });

    for (const d of [3, 2, 1]) await recordIncident(venue, admin, { coach_id: coachId, kind: "no_show", occurred_on: daysAgo(d) });
    const open = (await listWarnings(branchId)).find((x) => x.status === "proposed");
    expect(open).toMatchObject({ level: 2, incident_count: 3 });
  });

  it("potongan bulan: jumlah persen kejadian aktif, dibatasi maksimum; void mengurangi", async () => {
    await saveDisciplineRules(branchId, { max_deduction_percent: 40 }, admin);
    const month = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
    const byMonth = await query<{ m: string; s: number }>(
      `SELECT to_char(occurred_on,'YYYY-MM') AS m, SUM(deduction_percent)::float8 AS s FROM studio.coach_incidents WHERE coach_id = $1 AND status = 'active' GROUP BY 1`,
      [coachId]
    );
    const expected = Math.min(40, byMonth.find((r) => r.m === month)?.s ?? 0);
    expect((await periodDeductions(branchId, month))[coachId] ?? 0).toBe(expected);

    const anyActive = await queryOne<{ id: string; deduction_percent: number }>(
      `SELECT id, deduction_percent::float8 AS deduction_percent FROM studio.coach_incidents WHERE coach_id = $1 AND status = 'active' AND to_char(occurred_on,'YYYY-MM') = $2 ORDER BY deduction_percent DESC LIMIT 1`,
      [coachId, month]
    );
    if (anyActive) {
      await voidIncident(branchId, anyActive.id, pd, "Ada surat dokter");
      await expect(voidIncident(branchId, anyActive.id, pd, "Ada surat dokter")).rejects.toMatchObject({ status: 404 });
      const after = (await periodDeductions(branchId, month))[coachId] ?? 0;
      expect(after).toBe(Math.min(40, (byMonth.find((r) => r.m === month)?.s ?? 0) - anyActive.deduction_percent));
    }
  });
});
