/**
 * Test integrasi SOP coach berversi (EPIC-067 T-067-D1). HANYA jalan bila
 * DATABASE_URL menunjuk database *_test; fixture dihapus sesudahnya. WA di-mock.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const wa: string[] = [];
vi.mock("@/lib/studio/staff-wa", () => ({
  sendStaffWa: vi.fn(async (_t: string, _k: string, phone: string | null, message: string) => {
    wa.push(message);
    return Boolean(phone);
  }),
}));

import { query } from "@/lib/db";
import {
  acknowledgeSop,
  coachSopStatus,
  createSopDocument,
  getSopDocument,
  listSopDocuments,
  publishSopVersion,
  remindUnacknowledged,
  setSopActive,
  sopTemplate,
} from "./sop-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const venue = { companyId: branchId, branchId };
const tag = branchId.slice(0, 8);
const userId = randomUUID();
const coach: Record<string, { id: string; branch_id: string }> = {};
let docId = "";
let employeeId = "";

describe.skipIf(!IS_TEST_DB)("SOP coach berversi (DB)", () => {
  beforeAll(async () => {
    await query(`INSERT INTO auth.users (id, email, password_hash) VALUES ($1, $2, 'x')`, [userId, `${userId}@d1.test`]);
    employeeId = (await query<{ id: string }>(
      `INSERT INTO hris.employees (user_id, full_name, nip, email, phone, join_date) VALUES ($1, $2, $3, $4, '-', CURRENT_DATE) RETURNING id`,
      [userId, `Coach pras ${tag}`, `D1-${tag}`, `${tag}@d1emp.test`]
    ))[0].id;
    for (const [k, phone, emp] of [["pras", "081277700044", employeeId], ["rara", null, null], ["tanpa", "081277700055", null]] as const) {
      const id = (await query<{ id: string }>(
        `INSERT INTO studio.coaches (company_id, branch_id, full_name, phone, employee_id) VALUES ($1, $1, $2, $3, $4) RETURNING id`,
        [branchId, `Coach ${k} ${tag}`, phone, emp]
      ))[0].id;
      coach[k] = { id, branch_id: branchId };
    }
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.sop_documents WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM hris.employees WHERE id = $1`, [employeeId]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
  });

  it("template memakai pengaturan venue (default)", async () => {
    const t = await sopTemplate(branchId);
    expect(t.title).toContain("SOP Coach");
    expect(t.body).toContain("Cuti Tahunan: minimal H-7");
  });

  it("buat → versi 1; coach melihat dan mengonfirmasi; laporan menghitung", async () => {
    docId = await createSopDocument(venue, userId, { title: "SOP Coach Uji", body: "Isi SOP versi satu untuk pengujian." });
    expect((await coachSopStatus(coach.pras))[0]).toMatchObject({ version: 1, acknowledged_at: null });
    const v1 = (await coachSopStatus(coach.pras))[0].version_id;
    await acknowledgeSop(coach.pras, userId, v1);
    await acknowledgeSop(coach.pras, userId, v1); // idempoten
    const list = await listSopDocuments(branchId);
    expect(list[0]).toMatchObject({ version: 1, coaches_total: 3, coaches_acked: 1 });
    const d = (await getSopDocument(branchId, docId))!;
    expect(d.coaches.map((c) => [c.coach_name.split(" ")[1], c.has_login, c.acknowledged_at !== null])).toEqual([
      ["rara", false, false],
      ["tanpa", false, false],
      ["pras", true, true],
    ]);
  });

  it("versi baru → semua wajib konfirmasi ulang; versi lama tidak bisa dikonfirmasi", async () => {
    const old = (await coachSopStatus(coach.pras))[0].version_id;
    expect(await publishSopVersion(branchId, docId, userId, { title: "SOP Coach Uji", body: "Isi SOP versi dua, ada aturan baru.", change_note: "Tambah aturan blackout" })).toBe(2);
    const now = (await coachSopStatus(coach.pras))[0];
    expect(now).toMatchObject({ version: 2, acknowledged_at: null, change_note: "Tambah aturan blackout" });
    await expect(acknowledgeSop(coach.rara, userId, old)).rejects.toMatchObject({ status: 409 });
    expect((await listSopDocuments(branchId))[0]).toMatchObject({ version: 2, coaches_acked: 0 });
    expect((await getSopDocument(branchId, docId))!.versions.map((v) => [v.version, v.acked])).toEqual([
      [2, 0],
      [1, 1],
    ]);
  });

  it("pengingat WA hanya ke coach ber-akun yang belum konfirmasi; dokumen diarsipkan tidak diminta lagi", async () => {
    const r = await remindUnacknowledged(branchId, docId);
    expect(r).toEqual({ sent: 1, pending: 1 }); // hanya Pras (punya akun); Rara & "tanpa" belum punya akun
    expect(wa[0]).toContain("SOP Coach Uji (versi 2)");
    await setSopActive(branchId, docId, false);
    expect(await coachSopStatus(coach.pras)).toEqual([]);
    await expect(remindUnacknowledged(branchId, docId)).rejects.toMatchObject({ status: 409 });
  });
});
