import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { consecutiveStreakWeeks, isoWeekStart } from "@/lib/studio/loyalty";
import { loadStudioRules, memberProgress } from "@/lib/studio/loyalty-server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { venueToday } from "@/lib/studio/pass-server";
import { studioRoute } from "@/lib/studio/server";

/** Progres member: tier, XP lifetime & saldo, benefit, streak minggu ini, riwayat XP. */
export async function GET() {
  return studioRoute("member progress", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const [progress, rules, today] = await Promise.all([memberProgress(customerId), loadStudioRules(), venueToday()]);
    const weekStart = isoWeekStart(today);
    const minSessions = Math.max(1, Number(rules.find((r) => r.source_type === "weekly_streak")?.metadata?.min_sessions) || 3);
    const dates = await query<{ d: string }>(
      `SELECT s.session_date::text AS d FROM studio.bookings b JOIN studio.class_sessions s ON s.id = b.session_id
       WHERE b.customer_id = $1 AND b.branch_id = $2 AND b.status = 'attended' AND s.session_date >= $3::date - 70`,
      [customerId, actor.branchId, weekStart]
    );
    const all = dates.map((r) => r.d);
    const thisWeek = all.filter((d) => d >= weekStart).length;
    const lastWeekStart = new Date(`${weekStart}T00:00:00Z`);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
    const streakWeeks = thisWeek >= minSessions
      ? consecutiveStreakWeeks(all, weekStart, minSessions)
      : consecutiveStreakWeeks(all, lastWeekStart.toISOString().slice(0, 10), minSessions);
    const history = await query(
      `SELECT id, direction, source_type, xp_delta, description, created_at
       FROM crm.crm_xp_ledger WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 15`,
      [customerId]
    );
    const total = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM studio.bookings WHERE customer_id = $1 AND status = 'attended'`,
      [customerId]
    );
    const earnRules = rules
      .filter((r) => r.is_active)
      .map((r) => ({ code: r.code, name: r.name, xp_mode: r.xp_mode, xp_value: r.xp_value, amount_step: r.amount_step, metadata: r.metadata }));
    return NextResponse.json({
      success: true,
      data: {
        status: progress.status,
        frozen: progress.frozen,
        lifetime_xp: progress.lifetime_xp,
        xp_balance: progress.xp_balance,
        tier: progress.tier,
        next: progress.next,
        benefits: progress.benefits,
        tiers: progress.tiers,
        streak: { this_week: thisWeek, min_sessions: minSessions, weeks: streakWeeks },
        total_sessions: total?.n ?? 0,
        earn_rules: earnRules,
        history,
      },
    });
  });
}
