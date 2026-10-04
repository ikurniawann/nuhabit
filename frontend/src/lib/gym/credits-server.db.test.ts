// @vitest-environment node
/**
 * Uji integrasi kredit gym ke Postgres sungguhan. Jalan hanya bila
 * GYM_DB_TEST=1 dan DATABASE_URL lokal; semua tulisan di-ROLLBACK.
 *   GYM_DB_TEST=1 DATABASE_URL=postgres://postgres@localhost:55432/nuhabit npx vitest run src/lib/gym/credits-server.db.test.ts
 */
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPool } from "@/lib/db";
import { isLocalDatabase } from "@/lib/member-portal/dev-bypass";
import {
  createCreditPurchase,
  markCreditPurchasePaid,
  payCreditPurchaseWithArk,
  refundCreditPurchase,
} from "./credit-purchases-server";
import {
  adjustCredits,
  deductCredits,
  getCreditBalance,
  getCoveredClassTypeIds,
  GymCreditError,
  loadCreditWallet,
  refundCredits,
  reverseCreditEntry,
} from "./credits-server";

const enabled = process.env.GYM_DB_TEST === "1" && isLocalDatabase();

describe.skipIf(!enabled)("gym credits against Postgres", () => {
  let client: PoolClient;
  let customerId: string;
  let packageId: string;
  let trialId: string;

  beforeEach(async () => {
    client = await getPool().connect();
    await client.query("BEGIN");
    const member = await client.query(
      `INSERT INTO pos.pos_customers (phone, name, ark_coin_balance) VALUES ($1, 'Uji Kredit', 2000000) RETURNING id`,
      [`+62000${Date.now()}`]
    );
    customerId = member.rows[0].id;
    const pkg = await client.query(
      `INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days) VALUES ('Uji 10', 10, 1500000, 90) RETURNING id`
    );
    packageId = pkg.rows[0].id;
    const trial = await client.query(
      `INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days, purchase_limit_per_member)
       VALUES ('Uji Trial', 1, 200000, 14, 1) RETURNING id`
    );
    trialId = trial.rows[0].id;
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
    client.release();
  });

  const buy = async (pkg = packageId) => {
    const purchase = await createCreditPurchase(client, {
      customerId,
      packageId: pkg,
      channel: "front_desk",
      paymentMethod: "cash",
    });
    return markCreditPurchasePaid(client, purchase.id);
  };

  it("issues credits once per paid purchase", async () => {
    const first = await buy();
    expect(first.status).toBe("paid");
    expect(await markCreditPurchasePaid(client, first.purchase.id)).toMatchObject({ status: "already_paid" });
    expect(await getCreditBalance(client, customerId)).toBe(10);
  });

  it("deducts FIFO idempotently and refuses overdraft", async () => {
    await buy();
    const input = { customerId, amount: 3, sourceType: "booking", sourceId: customerId, idempotencyKey: `t-${customerId}` };
    expect(await deductCredits(client, input)).toEqual({ ok: true, balanceAfter: 7 });
    expect(await deductCredits(client, input)).toEqual({ ok: true, balanceAfter: 7 });
    expect(await deductCredits(client, { ...input, amount: 8, idempotencyKey: `t2-${customerId}` })).toEqual({
      ok: false,
      reason: "insufficient",
    });
    await refundCredits(client, { ...input, amount: 3, idempotencyKey: `r-${customerId}` });
    await refundCredits(client, { ...input, amount: 3, idempotencyKey: `r-${customerId}` });
    expect(await getCreditBalance(client, customerId)).toBe(10);
  });

  it("expires lapsed lots lazily and only once", async () => {
    await buy();
    await client.query(`UPDATE gym.credit_lots SET expires_at = now() - interval '1 day' WHERE customer_id = $1`, [customerId]);
    expect(await getCreditBalance(client, customerId)).toBe(0);
    expect(await getCreditBalance(client, customerId)).toBe(0);
    const { rows } = await client.query(`SELECT amount FROM gym.credit_ledger WHERE customer_id = $1 AND type = 'expiration'`, [
      customerId,
    ]);
    expect(rows).toEqual([{ amount: -10 }]);
  });

  it("adjusts with a reason and reverses entries once", async () => {
    await buy();
    await expect(adjustCredits(client, { customerId, amount: 2, reason: "", actorId: customerId })).rejects.toBeInstanceOf(
      GymCreditError
    );
    const adj = await adjustCredits(client, { customerId, amount: 2, reason: "kompensasi", actorId: customerId });
    expect(adj.balanceAfter).toBe(12);
    await reverseCreditEntry(client, { entryId: adj.entryId, reason: "salah member", actorId: customerId });
    await expect(
      reverseCreditEntry(client, { entryId: adj.entryId, reason: "lagi", actorId: customerId })
    ).rejects.toThrow(/sudah pernah/);
    const wallet = await loadCreditWallet(client, customerId);
    expect(wallet.balance).toBe(10);
    expect(wallet.lots.find((l) => l.package_id === null)?.remaining).toBe(0);
  });

  it("enforces the purchase limit and refunds ARK payments", async () => {
    const purchase = await createCreditPurchase(client, {
      customerId,
      packageId: trialId,
      channel: "member_portal",
      paymentMethod: "ark_coin",
    });
    await payCreditPurchaseWithArk(client, purchase);
    await expect(buy(trialId)).rejects.toThrow(/Batas pembelian/);
    const ark = async () =>
      Number((await client.query(`SELECT ark_coin_balance FROM pos.pos_customers WHERE id = $1`, [customerId])).rows[0].ark_coin_balance);
    expect(await ark()).toBe(1_800_000);
    const refunded = await refundCreditPurchase(client, purchase.id, { reason: "batal ikut", actorId: customerId });
    expect(refunded.status).toBe("refunded");
    expect(await ark()).toBe(2_000_000);
    expect(await getCreditBalance(client, customerId)).toBe(0);
  });

  it("refuses refund when credits were already used", async () => {
    const { purchase } = await buy();
    await deductCredits(client, { customerId, amount: 1, sourceType: "booking", sourceId: customerId, idempotencyKey: `u-${customerId}` });
    await expect(refundCreditPurchase(client, purchase.id, { reason: "minta refund", actorId: customerId })).rejects.toThrow(
      /tidak cukup/
    );
  });

  it("restricts class coverage to the package list", async () => {
    const classType = "00000000-0000-4000-8000-000000000001";
    await client.query(`UPDATE gym.credit_packages SET applicable_class_type_ids = ARRAY[$2::uuid] WHERE id = $1`, [
      packageId,
      classType,
    ]);
    await buy();
    expect(await getCoveredClassTypeIds(client, customerId)).toEqual([classType]);
  });
});
