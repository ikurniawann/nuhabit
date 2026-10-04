import { z } from "zod";
import { getPool } from "@/lib/db";
import type { MemberSettingsView } from "@/lib/member-app/home-views";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

const DEFAULTS: MemberSettingsView = { units: "METRIC", bookingReminders: true, language: "ID" };

/** GET — pengaturan member (gym.athlete_settings); bawaan bila belum pernah disimpan. */
export const GET = withMemberSession("Gagal memuat pengaturan", async (customerId) => {
  const { rows } = await getPool().query(
    `SELECT units, booking_reminders, language FROM gym.athlete_settings WHERE customer_id = $1`,
    [customerId]
  );
  const r = rows[0];
  const view: MemberSettingsView = r
    ? { units: r.units, bookingReminders: r.booking_reminders, language: r.language }
    : DEFAULTS;
  return memberJson(view);
});

const patchSchema = z.object({
  units: z.enum(["METRIC", "IMPERIAL"]).optional(),
  bookingReminders: z.boolean().optional(),
  language: z.enum(["EN", "ID"]).optional(),
});

/** PATCH — ubah sebagian pengaturan; baris dibuat saat pertama kali disimpan. */
export const PATCH = withMemberSession("Gagal menyimpan pengaturan", async (customerId, request: Request) => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return memberError("Data tidak valid");
  const { units, bookingReminders, language } = parsed.data;
  await getPool().query(
    `INSERT INTO gym.athlete_settings (customer_id, units, booking_reminders, language)
     VALUES ($1, COALESCE($2::text, $5), COALESCE($3::boolean, $6), COALESCE($4::text, $7))
     ON CONFLICT (customer_id) DO UPDATE
        SET units = COALESCE($2::text, gym.athlete_settings.units),
            booking_reminders = COALESCE($3::boolean, gym.athlete_settings.booking_reminders),
            language = COALESCE($4::text, gym.athlete_settings.language),
            updated_at = now()`,
    [
      customerId,
      units ?? null,
      bookingReminders ?? null,
      language ?? null,
      DEFAULTS.units,
      DEFAULTS.bookingReminders,
      DEFAULTS.language,
    ]
  );
  return memberJson({ ok: true });
});
