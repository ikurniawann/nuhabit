/**
 * Test integrasi SLA watcher WA inbox (EPIC-067 T-067-B3): penandaan baru kini
 * dikabarkan ke penerima notifikasi owner sebagai satu ringkasan. HANYA jalan
 * bila DATABASE_URL menunjuk database *_test. Pengiriman WA di-mock.
 */

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

const sent: { type: string; dedupKey: string; message: string }[] = [];
vi.mock("@/lib/wa/notifications-sender", () => ({
  sendOwnerNotification: vi.fn(async (i: { type: string; dedupKey: string; message: string }) => {
    sent.push(i);
    return { sent: true, recipients: 1 };
  }),
}));

import { query, queryOne } from "@/lib/db";
import { checkSlaBreaches } from "./cs-sla-watcher";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);
const ext = `b3-sla-${randomUUID().slice(0, 8)}`;

describe.skipIf(!IS_TEST_DB)("SLA watcher WA inbox (DB)", () => {
  afterAll(async () => {
    await query(`DELETE FROM crm.wa_conversations WHERE external_id = $1`, [ext]);
  });

  it("percakapan lewat SLA ditandai sekali dan dikabarkan dalam satu ringkasan", async () => {
    await query(
      `INSERT INTO crm.wa_conversations (external_id, phone, display_name, channel, status, awaiting_since)
       VALUES ($1, '6281200000099', 'Maya SLA', 'whatsapp', 'open', now() - interval '3 hours')`,
      [ext]
    );
    const r = await checkSlaBreaches();
    expect(r.breached).toBeGreaterThanOrEqual(1);
    const msg = sent.find((s) => s.type === "slaInbox");
    expect(msg?.message).toContain("Maya SLA — menunggu");
    const row = await queryOne<{ b: boolean; e: string | null }>(`SELECT sla_response_breached AS b, escalated_at AS e FROM crm.wa_conversations WHERE external_id = $1`, [ext]);
    expect(row).toMatchObject({ b: true });
    expect(row?.e).not.toBeNull();

    sent.length = 0;
    await checkSlaBreaches();
    expect(sent.some((s) => s.message.includes("Maya SLA"))).toBe(false);
  });
});
