import { getPool, withTransaction } from "@/lib/db";
import { fail, gymAdminRoute, ok, uuidParam } from "@/lib/gym/credits-admin-route";
import { listCreditPurchases } from "@/lib/gym/credit-purchases-server";
import { loadCreditWallet } from "@/lib/gym/credits-server";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ customerId: string }> };

/** GET — profil singkat, saldo, lot, kredit segera kedaluwarsa, buku besar, dan pembelian member. */
export const GET = gymAdminRoute(IAM.gymCredits, "Gagal memuat kredit member", async (_user, _request: Request, ctx: Ctx) => {
  const customerId = uuidParam.parse((await ctx.params).customerId);
  const { rows } = await getPool().query(
    `SELECT id, name, phone, email, COALESCE(is_active, true) AS is_active, membership_tier,
            COALESCE(ark_coin_balance, 0)::float AS ark_balance_idr
       FROM pos.pos_customers WHERE id = $1`,
    [customerId]
  );
  if (!rows[0]) return fail("Member tidak ditemukan", 404);
  const wallet = await withTransaction((client) => loadCreditWallet(client, customerId, 200));
  const purchases = await listCreditPurchases(getPool(), customerId);
  return ok({ member: rows[0], ...wallet, purchases });
});
