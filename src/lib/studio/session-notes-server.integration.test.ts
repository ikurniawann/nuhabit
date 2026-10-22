/**
 * Test integrasi catatan coach setelah sesi (EPIC-067 T-067-C4). HANYA jalan
 * bila DATABASE_URL menunjuk database *_test; fixture dihapus sesudahnya.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { createSessionNote, deleteSessionNote, notesForCustomers, releaseSessionNote } from "./session-notes-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const tag = branchId.slice(0, 8);
const coach: Record<string, { id: string; company_id: string; branch_id: string }> = {};
const session: Record<string, string> = {};
let maya = "";
let nana = "";
const userId = randomUUID();

describe.skipIf(!IS_TEST_DB)("catatan coach setelah sesi (DB)", () => {
  beforeAll(async () => {
    for (const k of ["pras", "rara", "budi"]) {
      const id = (await query<{ id: string }>(`INSERT INTO studio.coaches (company_id, branch_id, full_name) VALUES ($1, $1, $2) RETURNING id`, [branchId, `Coach ${k} ${tag}`]))[0].id;
      coach[k] = { id, company_id: branchId, branch_id: branchId };
    }
    maya = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, $2) RETURNING id`, [`Maya C4 ${tag}`, `c4-${tag}-1`]))[0].id;
    nana = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, $2) RETURNING id`, [`Nana C4 ${tag}`, `c4-${tag}-2`]))[0].id;
    const program = (await query<{ id: string }>(`INSERT INTO studio.programs (company_id, branch_id, code, name, kind) VALUES ($1, $1, $2, 'Hyrox Engine', 'class') RETURNING id`, [branchId, `C4-${tag}`]))[0].id;
    const mk = async (key: string, c: string, offset: number, members: string[]) => {
      session[key] = (await query<{ id: string }>(
        `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id)
         VALUES ($1, $1, (now() AT TIME ZONE 'Asia/Jakarta')::date + $2::int, '07:00', '08:00', $3, 10, $4) RETURNING id`,
        [branchId, offset, program, c]
      ))[0].id;
      for (const m of members) await query(`INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status) VALUES ($1, $1, $2, $3, 'attended')`, [branchId, session[key], m]);
    };
    await mk("prasYesterday", coach.pras.id, -1, [maya]);
    await mk("prasOld", coach.pras.id, -10, [maya]);
    await mk("prasTomorrow", coach.pras.id, 1, [maya]);
    await mk("raraTomorrow", coach.rara.id, 1, [maya]);
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.member_session_notes WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.bookings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.class_sessions WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM pos.pos_customers WHERE id = ANY($1::uuid[])`, [[maya, nana]]);
  });

  it("ditulis untuk sesi miliknya yang sudah berjalan (≤ 7 hari), hanya untuk member di sesi itu", async () => {
    await createSessionNote(coach.pras, userId, session.prasYesterday, { customer_id: maya, body: "Lutut kiri nyeri, ganti lunges dengan step-up", carry_forward: true });
    await createSessionNote(coach.pras, userId, session.prasYesterday, { customer_id: maya, body: "Pace row bagus", carry_forward: false });
    await expect(createSessionNote(coach.pras, userId, session.prasOld, { customer_id: maya, body: "terlalu lama", carry_forward: true })).rejects.toMatchObject({ status: 409 });
    await expect(createSessionNote(coach.pras, userId, session.prasTomorrow, { customer_id: maya, body: "belum mulai", carry_forward: true })).rejects.toMatchObject({ status: 409 });
    await expect(createSessionNote(coach.rara, userId, session.prasYesterday, { customer_id: maya, body: "bukan sesiku", carry_forward: true })).rejects.toMatchObject({ status: 404 });
    await expect(createSessionNote(coach.pras, userId, session.prasYesterday, { customer_id: nana, body: "tidak ikut", carry_forward: true })).rejects.toMatchObject({ status: 400 });
  });

  it("terbawa ke sesi berikutnya: yang dibawa di atas, riwayat di bawah", async () => {
    const notes = (await notesForCustomers(branchId, [maya, nana])).get(maya)!;
    expect(notes.map((n) => [n.body, n.pinned, n.coach_name.split(" ")[1], n.session_label])).toEqual([
      ["Lutut kiri nyeri, ganti lunges dengan step-up", true, "pras", "Hyrox Engine"],
      ["Pace row bagus", false, "pras", "Hyrox Engine"],
    ]);
    expect((await notesForCustomers(branchId, [nana])).get(nana)).toEqual([]);
  });

  it("dilepas oleh coach lain yang mengajar member; coach tanpa hubungan & bukan penulis tidak bisa", async () => {
    const pinned = (await notesForCustomers(branchId, [maya])).get(maya)!.find((n) => n.pinned)!;
    await expect(releaseSessionNote(coach.budi, pinned.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteSessionNote(coach.rara, pinned.id)).rejects.toMatchObject({ status: 403 });
    await releaseSessionNote(coach.rara, pinned.id);
    const after = (await notesForCustomers(branchId, [maya])).get(maya)!;
    expect(after.every((n) => !n.pinned)).toBe(true);
    // Tetap tampil sebagai riwayat (dibuat < 60 hari lalu).
    expect(after.map((n) => n.body)).toContain("Lutut kiri nyeri, ganti lunges dengan step-up");
  });

  it("penulis menghapus catatannya", async () => {
    const row = (await notesForCustomers(branchId, [maya])).get(maya)!.find((n) => n.body === "Pace row bagus")!;
    await deleteSessionNote(coach.pras, row.id);
    expect((await notesForCustomers(branchId, [maya])).get(maya)!.map((n) => n.body)).toEqual(["Lutut kiri nyeri, ganti lunges dengan step-up"]);
  });
});
