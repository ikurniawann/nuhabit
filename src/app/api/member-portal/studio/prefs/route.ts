import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { memberPrefsSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

/** Preferensi member: pengingat WhatsApp (default nyala). */
export async function GET() {
  return studioRoute("member prefs GET", async () => {
    const { customerId } = await requireMemberStudio();
    const row = await queryOne<{ wa_reminders: boolean; leaderboard_opt_in: boolean }>(
      `SELECT wa_reminders, leaderboard_opt_in FROM studio.member_prefs WHERE customer_id = $1`,
      [customerId]
    );
    return NextResponse.json({ success: true, data: { wa_reminders: row?.wa_reminders ?? true, leaderboard_opt_in: row?.leaderboard_opt_in ?? false } });
  });
}

export async function PUT(request: NextRequest) {
  return studioRoute("member prefs PUT", async () => {
    const { customerId } = await requireMemberStudio();
    const b = await validateBody(request, memberPrefsSchema);
    await query(
      `INSERT INTO studio.member_prefs (customer_id, wa_reminders, leaderboard_opt_in) VALUES ($1, COALESCE($2, true), COALESCE($3, false))
       ON CONFLICT (customer_id) DO UPDATE SET
         wa_reminders = COALESCE($2, studio.member_prefs.wa_reminders),
         leaderboard_opt_in = COALESCE($3, studio.member_prefs.leaderboard_opt_in), updated_at = now()`,
      [customerId, b.wa_reminders ?? null, b.leaderboard_opt_in ?? null]
    );
    const message =
      b.leaderboard_opt_in !== undefined
        ? b.leaderboard_opt_in ? "Kamu tampil di leaderboard" : "Kamu disembunyikan dari leaderboard"
        : b.wa_reminders ? "Pengingat WhatsApp dinyalakan" : "Pengingat WhatsApp dimatikan";
    return NextResponse.json({ success: true, data: b, message });
  });
}
