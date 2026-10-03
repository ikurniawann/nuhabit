import { z } from "zod";
import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { crmFail, crmOk, crmRoute } from "@/lib/crm/crm-route";
import { generatePartnerSecret, PARTNER_XP_CAP } from "@/lib/crm/partners";
import { hashSecret } from "@/lib/crm/partners-server";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  is_active: z.boolean().optional(),
  awards_xp: z.boolean().optional(),
  xp_per_event: z.number().int().min(0).max(PARTNER_XP_CAP).optional(),
  /** true = buat secret baru; secret lama langsung tidak berlaku. */
  rotate_secret: z.literal(true).optional(),
});

/** PATCH — ubah partner, atau rotasi secret (secret baru tampil sekali). */
export const PATCH = crmRoute(
  IAM.crmPartners,
  "Gagal memperbarui partner",
  async (_userId, request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = patchSchema.parse(await request.json());
    const sets: string[] = [];
    const values: unknown[] = [id];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (body.name !== undefined) add("name", body.name);
    if (body.is_active !== undefined) add("is_active", body.is_active);
    if (body.awards_xp !== undefined) add("awards_xp", body.awards_xp);
    if (body.xp_per_event !== undefined) add("xp_per_event", body.xp_per_event);
    const secret = body.rotate_secret ? generatePartnerSecret() : null;
    if (secret) {
      add("signing_secret", secret);
      add("secret_hash", hashSecret(secret));
      sets.push("secret_rotated_at = now()");
    }
    if (sets.length === 0) return crmFail("Tidak ada perubahan");

    const { rows } = await getPool().query(
      `UPDATE crm.crm_integration_partners SET ${sets.join(", ")} WHERE id = $1 RETURNING id`,
      values
    );
    if (!rows[0]) return crmFail("Partner tidak ditemukan", 404);
    return crmOk({ id, ...(secret ? { secret } : {}) }, secret ? "Secret baru dibuat" : "Partner diperbarui");
  }
);
