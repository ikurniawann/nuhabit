/**
 * Test integrasi penanda member perhatian khusus (EPIC-067 T-067-C1/C2) —
 * terutama aturan akses data medis. HANYA jalan bila DATABASE_URL menunjuk
 * database *_test; fixture dihapus sesudahnya.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, queryOne } from "@/lib/db";
import {
  addBackofficeFlag,
  addCoachFlag,
  backofficeFlagSummary,
  coachFlagsForCustomers,
  listFlagTypes,
  removeBackofficeFlag,
  removeCoachFlag,
} from "./member-flags-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const venue = { companyId: branchId, branchId };
const tag = branchId.slice(0, 8);
const coach: Record<string, { id: string; company_id: string; branch_id: string }> = {};
const members: Record<string, string> = {};
const type: Record<string, string> = {};
const userId = randomUUID(); // created_by tanpa FK

const wibToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const shift = (days: number) => new Date(Date.parse(`${wibToday()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!IS_TEST_DB)("penanda member & akses medis (DB)", () => {
  beforeAll(async () => {
    for (const t of await listFlagTypes()) type[t.code] = t.id;
    for (const k of ["pras", "rara", "budi"]) {
      const id = (await query<{ id: string }>(`INSERT INTO studio.coaches (company_id, branch_id, full_name) VALUES ($1, $1, $2) RETURNING id`, [branchId, `Coach ${k} ${tag}`]))[0].id;
      coach[k] = { id, company_id: branchId, branch_id: branchId };
    }
    for (const k of ["maya", "nana"]) {
      members[k] = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, $2) RETURNING id`, [`${k} ${tag}`, `x-${tag}-${k}`]))[0].id;
    }
    const program = (await query<{ id: string }>(
      `INSERT INTO studio.programs (company_id, branch_id, code, name, kind) VALUES ($1, $1, $2, 'Hyrox', 'class') RETURNING id`,
      [branchId, `C1-${tag}`]
    ))[0].id;
    const session = async (coachKey: string, date: string, status = "scheduled") =>
      (await query<{ id: string }>(
        `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id, status)
         VALUES ($1, $1, $2, '07:00', '08:00', $3, 10, $4, $5) RETURNING id`,
        [branchId, date, program, coach[coachKey].id, status]
      ))[0].id;
    const book = (sid: string, m: string, status = "booked") =>
      query(`INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status) VALUES ($1, $1, $2, $3, $4)`, [branchId, sid, members[m], status]);
    // Pras: Maya besok (sesi mendatang) · Rara: Maya 10 hari lalu (sudah selesai) · Budi: tidak mengajar Maya.
    await book(await session("pras", shift(1)), "maya");
    await book(await session("rara", shift(-10), "completed"), "maya", "attended");
    await book(await session("budi", shift(1)), "nana");
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.member_flags WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.bookings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.class_sessions WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM pos.pos_customers WHERE id = ANY($1::uuid[])`, [Object.values(members)]);
  });

  it("jenis bawaan: 3 medis + 3 umum", () => {
    expect(Object.keys(type)).toEqual(expect.arrayContaining(["injury", "medical_condition", "pregnant", "beginner", "vip", "complained"]));
  });

  it("backoffice hanya boleh menambah penanda umum", async () => {
    await addBackofficeFlag(venue, userId, members.maya, { type_id: type.vip, severity: "info", note: "Member founding" });
    await expect(addBackofficeFlag(venue, userId, members.maya, { type_id: type.injury, severity: "critical", note: "x" })).rejects.toMatchObject({ status: 403 });
  });

  it("coach yang tidak mengajar member tidak bisa mencatat; Rara (pernah mengajar) bisa mencatat medis", async () => {
    await expect(addCoachFlag(coach.budi, userId, members.maya, { type_id: type.injury, severity: "critical", note: "x" })).rejects.toMatchObject({ status: 403 });
    await addCoachFlag(coach.rara, userId, members.maya, { type_id: type.injury, severity: "critical", note: "Lutut kiri, hindari lunges" });
  });

  it("detail medis: Pras (sesi besok) & Rara (pembuat) melihat; Budi tidak; backoffice hanya jumlah", async () => {
    const forPras = await coachFlagsForCustomers(coach.pras.id, branchId, [members.maya]);
    expect(forPras.map((f) => f.type_label).sort()).toEqual(["Cedera", "VIP"]);
    expect(forPras.find((f) => f.category === "medical")?.note).toBe("Lutut kiri, hindari lunges");

    expect((await coachFlagsForCustomers(coach.rara.id, branchId, [members.maya])).some((f) => f.category === "medical")).toBe(true);
    const forBudi = await coachFlagsForCustomers(coach.budi.id, branchId, [members.maya]);
    expect(forBudi.map((f) => f.category)).toEqual(["general"]);

    const summary = await backofficeFlagSummary(branchId);
    const maya = summary.find((m) => m.customer_id === members.maya)!;
    expect(maya.medical_count).toBe(1);
    expect(maya.general.map((g) => g.type_label)).toEqual(["VIP"]);
    expect(JSON.stringify(summary)).not.toContain("Lutut");
    expect(JSON.stringify(summary)).not.toContain("Cedera");
  });

  it("lewat masa berlaku tidak tampil di mana pun", async () => {
    await query(`INSERT INTO studio.member_flags (company_id, branch_id, customer_id, type_id, severity, note, valid_until) VALUES ($1, $1, $2, $3, 'info', 'lama', $4)`, [
      branchId, members.nana, type.beginner, shift(-1),
    ]);
    expect(await coachFlagsForCustomers(coach.budi.id, branchId, [members.nana])).toEqual([]);
    expect((await backofficeFlagSummary(branchId)).some((m) => m.customer_id === members.nana)).toBe(false);
  });

  it("hapus: backoffice tidak bisa menghapus medis; coach yang berhak bisa", async () => {
    const medical = await queryOne<{ id: string }>(`SELECT id FROM studio.member_flags WHERE branch_id = $1 AND type_id = $2`, [branchId, type.injury]);
    await expect(removeBackofficeFlag(branchId, userId, medical!.id)).rejects.toMatchObject({ status: 403 });
    await expect(removeCoachFlag(coach.budi, userId, medical!.id)).rejects.toMatchObject({ status: 404 });
    await removeCoachFlag(coach.pras, userId, medical!.id);
    expect((await backofficeFlagSummary(branchId)).find((m) => m.customer_id === members.maya)?.medical_count).toBe(0);

    const vip = await queryOne<{ id: string }>(`SELECT id FROM studio.member_flags WHERE branch_id = $1 AND type_id = $2`, [branchId, type.vip]);
    await removeBackofficeFlag(branchId, userId, vip!.id);
    expect((await backofficeFlagSummary(branchId)).some((m) => m.customer_id === members.maya)).toBe(false);
  });
});
