/**
 * Test integrasi eskalasi tiket keluhan (EPIC-067 T-067-B3). HANYA jalan bila
 * DATABASE_URL menunjuk database *_test. Pengiriman WA di-mock.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const owner: { dedupKey: string; message: string }[] = [];
const pic: { dedupKey: string; phone: string | null }[] = [];
vi.mock("@/lib/wa/notifications-sender", () => ({
  sendOwnerNotification: vi.fn(async (i: { dedupKey: string; message: string }) => {
    owner.push(i);
    return { sent: true, recipients: 2 };
  }),
}));
vi.mock("@/lib/studio/staff-wa", () => ({
  sendStaffWa: vi.fn(async (_t: string, dedupKey: string, phone: string | null) => {
    pic.push({ dedupKey, phone });
    return Boolean(phone);
  }),
}));

import { query, queryOne } from "@/lib/db";
import { createComplaint, escalateOverdueComplaints, getComplaint, transitionComplaint } from "./complaints-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const venue = { companyId: branchId, branchId };
const tag = branchId.slice(0, 8);
let staff = "";
let employee = "";
const created = new Date("2026-10-20T03:00:00Z"); // 10.00 WIB, dua hari lalu (relatif ke "now" di bawah)
const day = new Date("2026-10-22T05:00:00Z"); // 12.00 WIB
const night = new Date("2026-10-22T16:00:00Z"); // 23.00 WIB

describe.skipIf(!IS_TEST_DB)("eskalasi keluhan (DB)", () => {
  beforeAll(async () => {
    staff = randomUUID();
    await query(`INSERT INTO auth.users (id, email, password_hash) VALUES ($1, $2, 'x')`, [staff, `${staff}@b3.test`]);
    await query(`INSERT INTO configuration.users (id, full_name, email, role, status) VALUES ($1, $2, $3, 'admin', 'active')`, [staff, `PIC B3 ${tag}`, `${staff}@b3.test`]);
    employee = (await query<{ id: string }>(
      `INSERT INTO hris.employees (user_id, full_name, nip, email, phone, join_date) VALUES ($1, $2, $3, $4, '081277700033', CURRENT_DATE) RETURNING id`,
      [staff, `PIC B3 ${tag}`, `B3-${tag}`, `${staff}@b3emp.test`]
    ))[0].id;
  });

  beforeEach(() => {
    owner.length = 0;
    pic.length = 0;
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.complaints WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM hris.employees WHERE id = $1`, [employee]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [staff]);
  });

  it("lewat batas respons → sekali WA ke owner + PIC, tercatat di riwayat; tidak diulang", async () => {
    const t = await createComplaint(venue, staff, { source: "front_desk", category: "facility", title: `AC mati ${tag}`, contact_name: "Tamu" }, created);
    await query(`UPDATE studio.complaints SET assignee_user_id = $2, resolve_by = $3 WHERE id = $1`, [t.id, staff, "2026-10-30T00:00:00Z"]);

    const r1 = await escalateOverdueComplaints(day);
    expect(r1.escalated).toBeGreaterThanOrEqual(1);
    const mine = owner.filter((o) => o.dedupKey === `complaint:${t.id}:respond`);
    expect(mine).toHaveLength(1);
    expect(mine[0].message).toContain("Keluhan belum ditangani");
    expect(mine[0].message).toContain(`PIC: PIC B3 ${tag}`);
    expect(pic.find((p) => p.dedupKey === `complaint:${t.id}:respond:pic`)?.phone).toBe("081277700033");

    const d = (await getComplaint(branchId, t.id))!;
    expect(d.respond_escalated_at).not.toBeNull();
    expect(d.resolve_escalated_at).toBeNull();
    expect(d.events.at(-1)).toMatchObject({ kind: "escalated" });
    expect(d.events.at(-1)?.body).toContain("Lewat batas respons — WA ke penerima notifikasi (2) & PIC");

    owner.length = 0;
    await escalateOverdueComplaints(day);
    expect(owner.some((o) => o.dedupKey.startsWith(`complaint:${t.id}`))).toBe(false);
  });

  it("sudah ditangani tepat waktu → tidak ada eskalasi respons; lewat batas selesai → eskalasi selesai", async () => {
    const t = await createComplaint(venue, staff, { source: "front_desk", category: "coach", title: `Coach telat ${tag}`, contact_name: "Tamu" }, created);
    await transitionComplaint(branchId, t.id, staff, "in_progress");
    await escalateOverdueComplaints(new Date("2026-10-21T05:00:00Z"));
    expect(owner.some((o) => o.dedupKey.startsWith(`complaint:${t.id}`))).toBe(false);

    await escalateOverdueComplaints(new Date("2026-10-23T05:00:00Z")); // > 72 jam
    expect(owner.map((o) => o.dedupKey)).toContain(`complaint:${t.id}:resolve`);
    expect((await getComplaint(branchId, t.id))!.respond_escalated_at).toBeNull();
  });

  it("dua-duanya terlewat → satu pesan (selesai), kedua penanda terisi", async () => {
    const t = await createComplaint(venue, staff, { source: "front_desk", category: "billing", title: `Tagihan ganda ${tag}`, contact_name: "Tamu" }, created);
    await escalateOverdueComplaints(new Date("2026-10-24T05:00:00Z"));
    expect(owner.filter((o) => o.dedupKey.startsWith(`complaint:${t.id}`)).map((o) => o.dedupKey)).toEqual([`complaint:${t.id}:resolve`]);
    const row = await queryOne<{ r: string | null; s: string | null }>(`SELECT respond_escalated_at AS r, resolve_escalated_at AS s FROM studio.complaints WHERE id = $1`, [t.id]);
    expect(row?.r).not.toBeNull();
    expect(row?.s).not.toBeNull();
  });

  it("malam hari: tiket biasa ditahan, tiket cedera langsung dikirim", async () => {
    const biasa = await createComplaint(venue, staff, { source: "front_desk", category: "facility", priority: "normal", title: `Lampu redup ${tag}`, contact_name: "Tamu" }, new Date("2026-10-21T10:00:00Z"));
    // Cedera dibuat 19.00 WIB: batas respons (2 jam) lewat pukul 21.00, batas selesai (24 jam) belum.
    const cedera = await createComplaint(venue, staff, { source: "front_desk", category: "injury", title: `Lutut ${tag}`, contact_name: "Tamu" }, new Date("2026-10-22T12:00:00Z"));
    const r = await escalateOverdueComplaints(night);
    expect(r.held).toBeGreaterThanOrEqual(1);
    const keys = owner.map((o) => o.dedupKey);
    expect(keys).toContain(`complaint:${cedera.id}:respond`);
    expect(keys.some((k) => k.startsWith(`complaint:${biasa.id}`))).toBe(false);
  });
});
