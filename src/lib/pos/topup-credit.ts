import type { DbClient } from "@/lib/pg/types";
import { withTransaction } from "@/lib/db";
import { awardCrmXpForTopup } from "@/lib/crm/loyalty-engine";
import {
  calculateTopupXp,
  idrToArk,
  loadPosLoyaltySettings,
} from "@/lib/pos/loyalty-settings";
import { expiresAtFor, roundIdr } from "@/lib/wallet/ledger";
import { lockCustomer, setCustomerBalance, WALLET_COLUMNS, type WalletRow } from "@/lib/wallet/server";
import { creditTopupBonus } from "@/lib/wallet/topup";

/**
 * Kredit top-up QRIS yang masih pending (webhook Xendit, rekonsiliasi, atau
 * simulasi dev). Satu transaksi DB dengan baris top-up & member terkunci, jadi
 * webhook dan poll yang datang bersamaan tidak bisa mengkredit dua kali.
 * Top-up paket (metadata.package_id) ikut menulis lot bonus dan masa berlakunya.
 */
export async function creditPendingTopup(
  db: DbClient,
  input: {
    transactionId: string;
    xenditPaymentId?: string | null;
    notes?: string;
  }
) {
  const loyaltySettings = await loadPosLoyaltySettings(db);

  const outcome = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${WALLET_COLUMNS} FROM pos.pos_wallet_transactions WHERE id = $1 FOR UPDATE`,
      [input.transactionId]
    );
    const tx = rows[0] as WalletRow | undefined;
    if (!tx) return { status: "not_found" as const };

    const status = String(tx.status || "completed");
    if (status === "completed") {
      return { status: "already_completed" as const, transaction: tx, balance_after: Number(tx.balance_after) || 0 };
    }
    if (status !== "pending") {
      return { status: "ignored" as const, transaction: tx, balance_after: 0 };
    }

    const customer = await lockCustomer(client, tx.customer_id);
    const amountValue = Number(tx.amount) || 0;
    const arkCoins = idrToArk(amountValue, loyaltySettings.ark_rate);
    const balanceBefore = customer.balance;
    const balanceAfterTopup = roundIdr(balanceBefore + amountValue);
    const now = new Date();
    const meta = tx.metadata || {};
    // Paket menyebut masa berlakunya sendiri (null = tidak kedaluwarsa);
    // top-up bebas dibiarkan null agar trigger memakai masa berlaku default.
    const expiresAt = "validity_days" in meta ? expiresAtFor(meta.validity_days as number | null, now) : null;

    await setCustomerBalance(client, tx.customer_id, balanceAfterTopup);
    await client.query(`UPDATE pos.pos_customers SET total_spent = COALESCE(total_spent, 0) + $2 WHERE id = $1`, [
      tx.customer_id,
      amountValue,
    ]);

    const { rows: updated } = await client.query(
      `UPDATE pos.pos_wallet_transactions
          SET status = 'completed', ark_coins = $2, balance_before = $3, balance_after = $4, notes = $5,
              metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
              xendit_transaction_id = COALESCE(NULLIF(xendit_transaction_id, ''), $7),
              expires_at = COALESCE($8, expires_at)
        WHERE id = $1
        RETURNING ${WALLET_COLUMNS}`,
      [
        tx.id,
        arkCoins,
        balanceBefore,
        balanceAfterTopup,
        input.notes || tx.notes || "Top-up QRIS",
        JSON.stringify({ credited_at: now.toISOString(), xendit_payment_id: input.xenditPaymentId || null }),
        input.xenditPaymentId || null,
        expiresAt,
      ]
    );

    let balanceAfter = balanceAfterTopup;
    const bonusIdr = Math.max(0, Number(meta.bonus_idr) || 0);
    if (bonusIdr > 0) {
      const bonus = await creditTopupBonus(client, {
        customerId: tx.customer_id,
        topupId: tx.id,
        bonusIdr,
        expiresAt,
        packageMetadata: {
          package_id: meta.package_id ?? null,
          package_name: meta.package_name ?? null,
          validity_days: meta.validity_days ?? null,
        },
        arkRate: loyaltySettings.ark_rate,
        companyId: tx.company_id,
        branchId: tx.branch_id,
      });
      balanceAfter = bonus.balanceAfter;
    }

    return {
      status: "completed" as const,
      transaction: updated[0] as WalletRow,
      customerId: tx.customer_id,
      amountValue,
      arkCoins,
      balanceBefore,
      balanceAfter,
    };
  });

  if (outcome.status !== "completed") {
    return outcome.status === "not_found" ? outcome : { ...outcome, xp_awarded: 0 };
  }

  const crmXp = await awardCrmXpForTopup(db, {
    customerId: outcome.customerId,
    topupAmountIdr: outcome.amountValue,
    transactionId: input.transactionId,
  });

  return {
    status: "completed" as const,
    transaction: outcome.transaction,
    balance_before: outcome.balanceBefore,
    balance_after: outcome.balanceAfter,
    ark_coins: outcome.arkCoins,
    ark_rate: loyaltySettings.ark_rate,
    xp_awarded: crmXp.xpAwarded || calculateTopupXp(outcome.amountValue, loyaltySettings),
  };
}
