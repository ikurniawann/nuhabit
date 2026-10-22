/**
 * Test integrasi Membership (EPIC-069) — spending 12 bulan dari paket & POS,
 * naik/turun tier, benefit booking, diskon, dan urutan waitlist. HANYA jalan
 * bila DATABASE_URL menunjuk database *_test; fixture dihapus sesudahnya.
 *
 * Tier Membership bersifat global, jadi ambangnya dibuat sangat tinggi (miliaran
 * rupiah) supaya member fixture test lain yang berjalan paralel tidak ikut naik tier.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, queryOne } from "@/lib/db";
import { memberBenefits, setMemberStatus } from "./loyalty-server";
import { evaluateMember, memberMembership, memberMembershipDiscount, memberSpend, storedMembershipDiscounts } from "./membership-server";

const DB_URL = process.env.DATABASE_URL || "";
const IS_TEST_DB = /\/[a-z0-9_]+_test(\?|$)/i.test(DB_URL);

const branchId = randomUUID();
const tag = branchId.slice(0, 8);
const B = 2_000_000_000 + Math.floor(Math.random() * 1_000_000) * 1000; // basis ambang unik per run
const members: Record<string, string> = {};
const tiers: Record<string, string> = {};
let productId = "";

const wibToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function pass(customer: string, price: number, opts: { status?: string; channel?: string; daysAgo?: number } = {}) {
  const at = `${shift(wibToday(), -(opts.daysAgo ?? 0))}T10:00:00+07:00`;
  await query(
    `INSERT INTO studio.member_passes (company_id, branch_id, pass_code, customer_id, product_id, product_name, category, status,
       class_credits_total, price_paid, valid_from, valid_until, channel, paid_at, created_at)
     VALUES ($1, $1, $2, $3, $8, 'Test pass', 'class', $4, 10, $5, CURRENT_DATE, CURRENT_DATE + 30, $6, $7, $7)`,
    [branchId, `M${randomUUID().slice(0, 8)}`, customer, opts.status ?? "active", price, opts.channel ?? "front_desk", at, productId]
  );
}

async function posOrder(customer: string, total: number, opts: { paid?: boolean; voided?: boolean; daysAgo?: number } = {}) {
  await query(
    `INSERT INTO pos.pos_orders (order_number, cashier_id, customer_id, subtotal, total_amount, amount_paid, payment_status, status, voided_at, created_at)
     VALUES ($1, gen_random_uuid(), $2, $3, $3, $3, $4, $5, $6, now() - make_interval(days => $7))`,
    [
      `MB-${randomUUID().slice(0, 10)}`,
      customer,
      total,
      opts.paid === false ? "unpaid" : "paid",
      opts.voided ? "voided" : "completed",
      opts.voided ? new Date().toISOString() : null,
      opts.daysAgo ?? 0,
    ]
  );
}

describe.skipIf(!IS_TEST_DB)("Membership dari spending (DB)", () => {
  beforeAll(async () => {
    productId = (await query<{ id: string }>(
      `INSERT INTO studio.pass_products (company_id, branch_id, code, name, validity_days, price, class_credits) VALUES ($1, $1, $2, 'Test pass', 30, 0, 10) RETURNING id`,
      [branchId, `MB-${tag}`]
    ))[0].id;
    for (const k of ["maya", "nana", "budi"]) {
      members[k] = (await query<{ id: string }>(`INSERT INTO pos.pos_customers (name, phone) VALUES ($1, $2) RETURNING id`, [`${k} ${tag}`, `mb-${tag}-${k}`]))[0].id;
    }
    const tier = async (name: string, min: number, extra: string) =>
      (await query<{ id: string }>(
        `INSERT INTO studio.membership_tiers (name, min_spend, discount_percent, early_booking_days, cancel_window_hours, waitlist_priority, perks)
         VALUES ($1, $2, ${extra}) RETURNING id`,
        [`${name} ${tag}`, min]
      ))[0].id;
    tiers.silver = await tier("Silver", B, "5, 1, NULL, false, ARRAY['Welcome drink']");
    tiers.gold = await tier("Gold", B * 2, "10, 3, 6, true, ARRAY['Guest pass 1x/bulan']");
  });

  afterAll(async () => {
    const ids = Object.values(members);
    await query(`DELETE FROM studio.membership_tier_changes WHERE customer_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM studio.member_memberships WHERE customer_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM studio.membership_tiers WHERE id = ANY($1::uuid[])`, [Object.values(tiers)]);
    await query(`DELETE FROM studio.member_passes WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM studio.pass_products WHERE branch_id = $1`, [branchId]);
    await query(`DELETE FROM pos.pos_orders WHERE customer_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM crm.crm_member_profiles WHERE customer_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM pos.pos_customers WHERE id = ANY($1::uuid[])`, [ids]);
  });

  it("spending: paket & POS lunas dalam 12 bulan; complimentary/pending/batal/void/lama tidak dihitung", async () => {
    const m = members.maya;
    await pass(m, B * 0.5);
    await pass(m, 999, { channel: "complimentary" });
    await pass(m, 888, { status: "pending_payment" });
    await pass(m, 777, { status: "cancelled" });
    await pass(m, 666, { daysAgo: 400 });
    await posOrder(m, B * 0.25);
    await posOrder(m, 555, { paid: false });
    await posOrder(m, 444, { voided: true });
    const s = await memberSpend(m, wibToday());
    expect(s.passes).toBe(B * 0.5);
    expect(s.pos).toBe(B * 0.25);
    expect(s.total).toBe(B * 0.75);
  });

  it("di bawah ambang → tanpa tier & tanpa benefit; naik langsung saat ambang tercapai", async () => {
    const m = members.maya;
    const before = await evaluateMember(m);
    expect(before.tier).toBeNull();
    expect(await memberBenefits(m)).toEqual({ early_booking_days: 0, cancel_window_hours: null, waitlist_priority: false });

    await posOrder(m, B * 0.25);
    const after = await evaluateMember(m);
    expect(after.tier?.id).toBe(tiers.silver);
    expect(after.change?.direction).toBe("up");
    expect(after.valid_until).toBe(shift(wibToday(), 365));
    expect(await memberBenefits(m)).toEqual({ early_booking_days: 1, cancel_window_hours: null, waitlist_priority: false });
    expect(await memberMembershipDiscount(m)).toBe(5);

    // Evaluasi ulang tanpa perubahan spending tidak mencatat perubahan lagi.
    expect((await evaluateMember(m)).change).toBeNull();
    const changes = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM studio.membership_tier_changes WHERE customer_id = $1`, [m]);
    expect(changes?.n).toBe(1);
  });

  it("ringkasan Member App: sisa ke tier berikutnya & perks", async () => {
    const r = await memberMembership(members.maya);
    expect(r.enabled).toBe(true);
    expect(r.tier?.name).toBe(`Silver ${tag}`);
    expect(r.next?.tier.id).toBe(tiers.gold);
    expect(r.next?.spend_needed).toBe(B);
    expect(r.keep).toBeNull();
    expect(r.history[0]).toMatchObject({ direction: "up", to_tier_name: `Silver ${tag}` });
  });

  it("masa berlaku: tier bertahan walau spending turun, turun setelah lewat masa berlaku", async () => {
    const m = members.nana;
    await pass(m, B * 2);
    expect((await evaluateMember(m)).tier?.id).toBe(tiers.gold);
    // Spending "keluar jendela" (pass kini dianggap 2 tahun lalu) — masih dalam masa berlaku.
    await query(`UPDATE studio.member_passes SET paid_at = now() - interval '730 days' WHERE customer_id = $1`, [m]);
    const kept = await evaluateMember(m);
    expect(kept.tier?.id).toBe(tiers.gold);
    expect(kept.change).toBeNull();
    const view = await memberMembership(m);
    expect(view.keep).toEqual({ spend_needed: B * 2, by: view.valid_until });
    // Masa berlaku habis → turun ke tanpa tier.
    await query(`UPDATE studio.member_memberships SET valid_until = CURRENT_DATE - 2 WHERE customer_id = $1`, [m]);
    const dropped = await evaluateMember(m);
    expect(dropped.tier).toBeNull();
    expect(dropped.change).toMatchObject({ direction: "down", from: { id: tiers.gold }, to: null });
  });

  it("member diblokir kehilangan benefit; diskon tersimpan untuk daftar POS", async () => {
    const m = members.budi;
    await pass(m, B * 2);
    await evaluateMember(m);
    expect(await memberBenefits(m)).toEqual({ early_booking_days: 3, cancel_window_hours: 6, waitlist_priority: true });
    expect(await storedMembershipDiscounts([m, members.maya, members.nana])).toEqual({ [m]: 10, [members.maya]: 5 });

    await setMemberStatus(m, "suspended", "test", randomUUID());
    expect(await memberBenefits(m)).toEqual({ early_booking_days: 0, cancel_window_hours: null, waitlist_priority: false });
    expect(await memberMembershipDiscount(m)).toBe(0);
    expect(await storedMembershipDiscounts([m])).toEqual({});
  });
});
