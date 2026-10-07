import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { getMemberSession } from "@/lib/member-portal/session";
import {
  computeProfileCompletion,
  type MemberProfileFields,
} from "@/lib/member-portal/profile";
import { awardMemberFreeXp } from "@/lib/crm/loyalty-engine";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { dateColToIso } from "@/lib/payroll/period";

const profileSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().email().max(160).or(z.literal("")).optional(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
  gender: z.enum(["male", "female"]).or(z.literal("")).optional(),
  city: z.string().trim().max(120).optional(),
  photo_url: z.string().trim().max(500).optional(),
  wa_consent: z.boolean().optional(),
});

/**
 * PUT /api/member-portal/profile — member melengkapi profilnya sendiri.
 * Profil 100% lengkap → Free XP (crm_settings.profile_completion_free_xp)
 * SEKALI seumur hidup, idempotent dua lapis (kolom + ledger). Nomor HP
 * TIDAK bisa diubah dari portal (identitas login OTP).
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getMemberSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = profileSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Data profil tidak valid" },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const pool = getPool();
    const updates: string[] = ["updated_at = now()"];
    const params: unknown[] = [session.customerId];
    const push = (column: string, value: unknown) => {
      params.push(value);
      updates.push(`${column} = $${params.length}`);
    };
    if (input.name !== undefined) push("name", input.name);
    if (input.email !== undefined) push("email", input.email || null);
    if (input.birth_date !== undefined) push("birth_date", input.birth_date || null);
    if (input.gender !== undefined) push("gender", input.gender || null);
    if (input.city !== undefined) push("city", input.city || null);
    if (input.photo_url !== undefined) push("photo_url", input.photo_url || null);
    if (input.wa_consent !== undefined) push("wa_consent", input.wa_consent);

    const { rows } = await pool.query(
      `UPDATE pos.pos_customers SET ${updates.join(", ")}
       WHERE id = $1
       RETURNING id, name, phone, email, birth_date, gender, city, photo_url,
                 wa_consent, profile_completed_at, free_xp_granted_at`,
      params
    );
    const customer = rows[0];
    if (!customer) {
      return NextResponse.json({ success: false, error: "Member tidak ditemukan" }, { status: 404 });
    }

    const fields: MemberProfileFields = {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      birth_date: dateColToIso(customer.birth_date),
      gender: customer.gender,
      city: customer.city,
      photo_url: customer.photo_url,
      wa_consent: customer.wa_consent,
    };
    const completion = computeProfileCompletion(fields);

    let freeXpAwarded = 0;
    if (completion.complete && !customer.profile_completed_at) {
      await pool.query(
        `UPDATE pos.pos_customers SET profile_completed_at = now() WHERE id = $1`,
        [session.customerId]
      );
    }
    if (completion.complete && !customer.free_xp_granted_at) {
      const { rows: settingRows } = await pool.query(
        `SELECT value FROM crm.crm_settings WHERE key = 'profile_completion_free_xp'`
      );
      const amount = Number(settingRows[0]?.value) || 0;
      if (amount > 0) {
        const db = createPgClient();
        const venue = await getCrmDefaultVenue(db);
        const result = await awardMemberFreeXp(db, {
          customerId: session.customerId,
          xpAmount: amount,
          companyId: venue.companyId,
          branchId: venue.branchId,
        });
        if (result.status === "posted" || result.status === "duplicate") {
          await pool.query(
            `UPDATE pos.pos_customers
             SET free_xp_granted_at = COALESCE(free_xp_granted_at, now())
             WHERE id = $1`,
            [session.customerId]
          );
          freeXpAwarded = result.xpAwarded;
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { completion, free_xp_awarded: freeXpAwarded },
      message:
        freeXpAwarded > 0
          ? `Profil lengkap! Selamat, Anda mendapat ${freeXpAwarded} Free XP 🎉`
          : "Profil tersimpan",
    });
  } catch (error) {
    console.error("Error updating member profile:", error);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan profil" },
      { status: 500 }
    );
  }
}
