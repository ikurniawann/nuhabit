import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { leaderboard, loadStudioRules, loadTiers } from "@/lib/studio/loyalty-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Program Loyalitas: aturan XP, tier & benefit, ringkasan, leaderboard bulan ini. */
export async function GET() {
  return studioRoute("loyalty GET", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.loyalty"]);
    const [rules, tiers, perTier, issued, board, settings] = await Promise.all([
      loadStudioRules(),
      loadTiers(),
      query<{ tier_id: string; n: number }>(
        `SELECT mp.tier_id, COUNT(*)::int AS n FROM crm.crm_member_profiles mp
         WHERE mp.status NOT IN ('suspended','banned','merged') GROUP BY mp.tier_id`
      ),
      query<{ xp: number; members: number }>(
        `SELECT COALESCE(SUM(xp_delta), 0)::int AS xp, COUNT(DISTINCT customer_id)::int AS members
         FROM crm.crm_xp_ledger WHERE source_channel = 'studio' AND direction = 'earn' AND created_at > now() - interval '30 days'`
      ),
      leaderboard(ctx.branchId, null, 10),
      query<{ key: string; value: unknown }>(`SELECT key, value FROM crm.crm_settings WHERE key IN ('ark_coin_enabled', 'xp_enabled')`),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        rules,
        tiers: tiers.map((t) => ({ ...t, members: perTier.find((p) => p.tier_id === t.id)?.n ?? 0 })),
        issued_30d: issued[0] ?? { xp: 0, members: 0 },
        leaderboard: board.entries,
        ark_coin_enabled: settings.find((s) => s.key === "ark_coin_enabled")?.value !== false,
      },
    });
  });
}
