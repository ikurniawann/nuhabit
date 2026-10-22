/**
 * Test integrasi PAR-Q → penanda medis (EPIC-067 T-067-C3). HANYA jalan bila
 * DATABASE_URL menunjuk database *_test; fixture dihapus sesudahnya.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import type { BookingActor } from "./booking-server";
import { backofficeFlagSummary, coachFlagsForCustomers, reviewParqFlag } from "./member-flags-server";
import { PARQ_QUESTIONS } from "./parq";
import { memberParqStatus, submitParq } from "./parq-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const tag = branchId.slice(0, 8);
const actor: BookingActor = { companyId: branchId, branchId, actorId: null, staff: false };
const coach: Record<string, { id: string; branch_id: string }> = {};
let customerId = "";
const allNo = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q.code, false]));

const parqFlags = () =>
  query<{ code: string; severity: string; note: string; needs_review: boolean; removed: boolean }>(
    `SELECT t.code, f.severity, f.note, f.needs_review, f.removed_at IS NOT NULL AS removed
     FROM studio.member_flags f JOIN studio.member_flag_types t ON t.id = f.type_id
     WHERE f.customer_id = $1 AND f.source = 'parq' ORDER BY f.created_at, t.code`,
    [customerId]
  );

describe.skipIf(!IS_TEST_DB)("PAR-Q → penanda medis (DB)", () => {
  beforeAll(async () => {
    customerId = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, $2) RETURNING id`, [`Maya C3 ${tag}`, `c3-${tag}`]))[0].id;
    const program = (await query<{ id: string }>(`INSERT INTO studio.programs (company_id, branch_id, code, name, kind) VALUES ($1, $1, $2, 'Hyrox', 'class') RETURNING id`, [branchId, `C3-${tag}`]))[0].id;
    for (const k of ["pras", "rara"]) {
      const id = (await query<{ id: string }>(`INSERT INTO studio.coaches (company_id, branch_id, full_name) VALUES ($1, $1, $2) RETURNING id`, [branchId, `Coach ${k} ${tag}`]))[0].id;
      coach[k] = { id, branch_id: branchId };
    }
    // Pras mengajar Maya besok; Rara tidak.
    const s = (await query<{ id: string }>(
      `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id)
       VALUES ($1, $1, (now() AT TIME ZONE 'Asia/Jakarta')::date + 1, '07:00', '08:00', $2, 10, $3) RETURNING id`,
      [branchId, program, coach.pras.id]
    ))[0].id;
    await query(`INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status) VALUES ($1, $1, $2, $3, 'booked')`, [branchId, s, customerId]);
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.member_flags WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.health_declarations WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.bookings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.class_sessions WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM pos.pos_customers WHERE id = $1`, [customerId]);
  });

  it("belum pernah mengisi → diminta; jawaban tidak lengkap ditolak", async () => {
    expect((await memberParqStatus(customerId)).due).toBe(true);
    await expect(submitParq(actor, customerId, { answers: { chest_pain: true } })).rejects.toMatchObject({ status: 400 });
  });

  it("jawaban ya → penanda medis perlu ditinjau; hanya coach yang mengajar yang melihat, backoffice hanya jumlah", async () => {
    const r = await submitParq(actor, customerId, { answers: { ...allNo, chest_pain: true, bone_joint: true }, details: "Lutut kiri pernah operasi" });
    expect(r).toMatchObject({ has_yes: true, flags: 2 });
    expect(await parqFlags()).toEqual([
      { code: "injury", severity: "attention", note: "PAR-Q: masalah tulang/sendi/otot. Keterangan member: Lutut kiri pernah operasi", needs_review: true, removed: false },
      { code: "medical_condition", severity: "critical", note: "PAR-Q: nyeri dada. Keterangan member: Lutut kiri pernah operasi", needs_review: true, removed: false },
    ]);
    expect((await coachFlagsForCustomers(coach.pras.id, branchId, [customerId])).filter((f) => f.source === "parq")).toHaveLength(2);
    expect(await coachFlagsForCustomers(coach.rara.id, branchId, [customerId])).toEqual([]);
    expect((await backofficeFlagSummary(branchId, customerId))[0]).toMatchObject({ general: [], medical_count: 2 });
    expect((await memberParqStatus(customerId)).due).toBe(false);
  });

  it("coach meninjau: konfirmasi (boleh ubah tingkat); coach lain tidak bisa", async () => {
    const flags = await coachFlagsForCustomers(coach.pras.id, branchId, [customerId]);
    const injury = flags.find((f) => f.type_label === "Cedera")!;
    await expect(reviewParqFlag(coach.rara, randomUUID(), injury.id, { keep: true })).rejects.toMatchObject({ status: 404 });
    await reviewParqFlag(coach.pras, randomUUID(), injury.id, { keep: true, severity: "critical" });
    expect((await parqFlags()).find((f) => f.code === "injury")).toMatchObject({ severity: "critical", needs_review: false });
  });

  it("isi ulang semua tidak: penanda belum ditinjau dihapus, yang sudah dikonfirmasi coach tetap", async () => {
    await submitParq(actor, customerId, { answers: allNo });
    expect((await parqFlags()).map((f) => [f.code, f.removed])).toEqual([
      ["injury", false],
      ["medical_condition", true],
    ]);
  });

  it("isi ulang dengan isi berubah: penanda yang sudah dikonfirmasi kembali perlu ditinjau", async () => {
    await submitParq(actor, customerId, { answers: { ...allNo, bone_joint: true }, details: "Bahu kanan cedera" });
    expect((await parqFlags()).find((f) => f.code === "injury" && !f.removed)).toMatchObject({
      note: "PAR-Q: masalah tulang/sendi/otot. Keterangan member: Bahu kanan cedera",
      severity: "attention",
      needs_review: true,
    });
    const flags = await coachFlagsForCustomers(coach.pras.id, branchId, [customerId]);
    await reviewParqFlag(coach.pras, randomUUID(), flags[0].id, { keep: false });
    expect((await parqFlags()).every((f) => f.removed)).toBe(true);
  });
});
