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
    const row = await queryOne<{ wa_reminders: boolean }>(`SELECT wa_reminders FROM studio.member_prefs WHERE customer_id = $1`, [customerId]);
    return NextResponse.json({ success: true, data: { wa_reminders: row?.wa_reminders ?? true } });
  });
}

export async function PUT(request: NextRequest) {
  return studioRoute("member prefs PUT", async () => {
    const { customerId } = await requireMemberStudio();
    const b = await validateBody(request, memberPrefsSchema);
    await query(
      `INSERT INTO studio.member_prefs (customer_id, wa_reminders) VALUES ($1, $2)
       ON CONFLICT (customer_id) DO UPDATE SET wa_reminders = EXCLUDED.wa_reminders, updated_at = now()`,
      [customerId, b.wa_reminders]
    );
    return NextResponse.json({
      success: true,
      data: b,
      message: b.wa_reminders ? "Pengingat WhatsApp dinyalakan" : "Pengingat WhatsApp dimatikan",
    });
  });
}
