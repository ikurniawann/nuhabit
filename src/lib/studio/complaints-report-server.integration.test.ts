/**
 * Test integrasi laporan keluhan & KPI coach (EPIC-067 T-067-B5). HANYA jalan
 * bila DATABASE_URL menunjuk database *_test; fixture dihapus sesudahnya.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool, query } from "@/lib/db";
import { collectCoachComplaintRate } from "@/lib/kpi/collectors-wave2";
import { complaintReport } from "./complaints-report-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const tag = branchId.slice(0, 8);
const coach: Record<string, string> = {};
let employeeId = "";
const customers: string[] = [];
// Periode uji di masa lalu supaya tidak bercampur data lain di branch acak ini.
const from = "2026-09-01";
const to = "2026-09-30";

async function complaint(o: {
  coach: string | null;
  category: string;
  kind?: string;
  status?: string;
  created: string;
  respondBy: string;
  resolveBy: string;
  firstResponse?: string | null;
  resolved?: string | null;
  escalated?: boolean;
  source?: string;
}) {
  await query(
    `INSERT INTO studio.complaints (company_id, branch_id, code, kind, source, category, priority, title, status, coach_id,
       created_at, respond_by, resolve_by, first_response_at, resolved_at, respond_escalated_at, resolve_escalated_at)
     VALUES ($1, $1, $2, $3, $4, $5, 'normal', 'uji', $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [
      branchId, `B5-${randomUUID().slice(0, 12)}`, o.kind ?? "complaint", o.source ?? "front_desk", o.category, o.status ?? "received", o.coach,
      o.created, o.respondBy, o.resolveBy, o.firstResponse ?? null, o.resolved ?? null, o.escalated ? o.respondBy : null,
    ]
  );
}

describe.skipIf(!IS_TEST_DB)("laporan keluhan & KPI coach (DB)", () => {
  beforeAll(async () => {
    employeeId = (await query<{ id: string }>(
      `INSERT INTO hris.employees (full_name, nip, email, phone, join_date) VALUES ($1, $2, $3, '-', CURRENT_DATE) RETURNING id`,
      [`Coach Pras ${tag}`, `B5-${tag}`, `${tag}@b5.test`]
    ))[0].id;
    for (const [k, emp] of [["pras", employeeId], ["rara", null], ["sepi", null]] as const) {
      coach[k] = (await query<{ id: string }>(
        `INSERT INTO studio.coaches (company_id, branch_id, full_name, employee_id) VALUES ($1, $1, $2, $3) RETURNING id`,
        [branchId, `Coach ${k} ${tag}`, emp]
      ))[0].id;
    }
    const program = (await query<{ id: string }>(`INSERT INTO studio.programs (company_id, branch_id, code, name, kind) VALUES ($1, $1, $2, 'Hyrox', 'class') RETURNING id`, [branchId, `B5-${tag}`]))[0].id;
    // Pras: 200 peserta hadir (2 sesi × 100); Rara: 50; satu sesi di luar periode tidak dihitung.
    const session = async (c: string, date: string, attended: number) => {
      const sid = (await query<{ id: string }>(
        `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, capacity, coach_id)
         VALUES ($1, $1, $2, '07:00', '08:00', $3, 200, $4) RETURNING id`,
        [branchId, date, program, c]
      ))[0].id;
      for (let i = 0; i < attended; i++) {
        if (!customers[i]) customers[i] = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, $2) RETURNING id`, [`M${i} ${tag}`, `b5-${tag}-${i}`]))[0].id;
        await query(`INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status) VALUES ($1, $1, $2, $3, 'attended')`, [branchId, sid, customers[i]]);
      }
    };
    await session(coach.pras, "2026-09-05", 100);
    await session(coach.pras, "2026-09-12", 100);
    await session(coach.rara, "2026-09-06", 50);
    await session(coach.pras, "2026-10-03", 10);

    // Pras: 2 keluhan (respons 2 jam & 30 jam, selesai 10 jam), 1 batal, 1 masukan. Rara: 1 cedera, eskalasi, belum direspons.
    await complaint({ coach: coach.pras, category: "coach", created: "2026-09-05T01:00:00Z", respondBy: "2026-09-06T01:00:00Z", resolveBy: "2026-09-08T01:00:00Z", firstResponse: "2026-09-05T03:00:00Z", resolved: "2026-09-05T11:00:00Z", status: "confirmed" });
    // Tiket terbuka ditandai sudah dieskalasi supaya watcher eskalasi (global) di tes lain yang berjalan paralel tidak memprosesnya.
    await complaint({ coach: coach.pras, category: "class", created: "2026-09-12T01:00:00Z", respondBy: "2026-09-13T01:00:00Z", resolveBy: "2026-09-15T01:00:00Z", firstResponse: "2026-09-13T07:00:00Z", status: "in_progress", source: "member_app", escalated: true });
    await complaint({ coach: coach.pras, category: "coach", created: "2026-09-12T02:00:00Z", respondBy: "2026-09-13T02:00:00Z", resolveBy: "2026-09-15T02:00:00Z", status: "cancelled" });
    await complaint({ coach: coach.pras, category: "coach", kind: "feedback", created: "2026-09-12T03:00:00Z", respondBy: "2026-09-13T03:00:00Z", resolveBy: "2026-09-15T03:00:00Z", source: "member_app" });
    await complaint({ coach: coach.rara, category: "injury", created: "2026-09-06T01:00:00Z", respondBy: "2026-09-06T03:00:00Z", resolveBy: "2026-09-07T01:00:00Z", escalated: true });
    // Di luar periode (sudah dieskalasi supaya watcher eskalasi global di tes lain tidak memprosesnya).
    await complaint({ coach: coach.pras, category: "coach", created: "2026-10-02T01:00:00Z", respondBy: "2026-10-03T01:00:00Z", resolveBy: "2026-10-05T01:00:00Z", escalated: true });
  });

  afterAll(async () => {
    await query(`DELETE FROM studio.complaints WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.bookings WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.class_sessions WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.programs WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.coaches WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM pos.pos_customers WHERE id = ANY($1::uuid[])`, [customers]);
    await query(`DELETE FROM hris.employees WHERE id = $1`, [employeeId]);
  });

  it("ringkasan: keluhan tanpa batal & masukan, waktu rata-rata, ketepatan batas waktu", async () => {
    const r = await complaintReport(branchId, from, to);
    expect(r.summary).toMatchObject({ total: 3, open: 2, closed: 1, escalated: 2, feedback: 1, cancelled: 1, avg_respond_hours: 16, avg_resolve_hours: 10 });
    // Respons: 1 dari 3 tepat waktu (30 jam & cedera tanpa respons terlambat). Selesai: 1 dari 3.
    expect(r.summary.respond_on_time).toBeCloseTo(1 / 3);
    expect(r.summary.resolve_on_time).toBeCloseTo(1 / 3);
    expect(r.by_category.map((c) => [c.category, c.total])).toEqual([["class", 1], ["coach", 1], ["injury", 1]]);
    expect(r.by_source.map((s) => [s.source, s.total])).toEqual([["front_desk", 2], ["member_app", 1]]);
  });

  it("per coach: keluhan, peserta, per 100 peserta, masukan; coach tanpa aktivitas tidak tampil", async () => {
    const r = await complaintReport(branchId, from, to);
    expect(r.by_coach.map((c) => [c.coach_name.split(" ")[1], c.total, c.about_coach, c.injury, c.attendees, c.rate_per_100, c.feedback])).toEqual([
      ["pras", 2, 1, 0, 200, 1, 1],
      ["rara", 1, 0, 1, 50, 2, 0],
    ]);
  });

  it("KPI coach_complaint_rate: hanya coach bertaut karyawan, keluhan / 100 peserta", async () => {
    const map = await collectCoachComplaintRate(getPool(), from, to);
    expect(map.get(employeeId)).toEqual({ actual: 1, sampleSize: 200, sourceDetail: { complaints: 2, about_coach: 1, attendees: 200 } });
  });
});
