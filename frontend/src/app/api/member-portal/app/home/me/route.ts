import { z } from "zod";
import { getPool, withTransaction } from "@/lib/db";
import { loadCreditWallet } from "@/lib/gym/credits-server";
import { WAIVER_VERSION } from "@/lib/member-app/home";
import type { MemberAccountView } from "@/lib/member-app/home-views";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

/** GET — akun member untuk beranda & profil: identitas, kontak darurat, waiver, saldo kredit kelas. */
export const GET = withMemberSession("Gagal memuat akun", async (customerId) => {
  const pool = getPool();
  const [{ rows }, wallet] = await Promise.all([
    pool.query(
      `SELECT id, name, email, phone, photo_url, is_active, created_at,
              emergency_contact, waiver_version, waiver_accepted_at
         FROM pos.pos_customers WHERE id = $1`,
      [customerId]
    ),
    withTransaction((client) => loadCreditWallet(client, customerId, 1)),
  ]);
  const c = rows[0];
  if (!c) return memberError("Member tidak ditemukan", 404);
  const view: MemberAccountView = {
    member: {
      id: c.id,
      fullName: c.name ?? "Member",
      email: c.email ?? "",
      phone: c.phone ?? "",
      avatarUrl: c.photo_url,
      status: c.is_active === false ? "INACTIVE" : "ACTIVE",
      createdAt: new Date(c.created_at).toISOString(),
      emergencyContact: c.emergency_contact,
      waiverVersion: c.waiver_version,
      waiverAcceptedAt: c.waiver_accepted_at ? new Date(c.waiver_accepted_at).toISOString() : null,
    },
    balance: wallet.balance,
    lowBalance: wallet.low_balance,
    expiringCredits: wallet.expiring_credits,
  };
  return memberJson(view);
});

const patchSchema = z.object({
  emergencyContact: z
    .object({
      name: z.string().trim().min(1).max(100),
      phone: z.string().trim().min(6).max(30),
      relation: z.string().trim().min(1).max(60),
    })
    .nullable()
    .optional(),
  acceptWaiver: z.literal(true).optional(),
});

/** PATCH { emergencyContact?, acceptWaiver? } — simpan kontak darurat dan/atau setujui waiver versi berjalan. */
export const PATCH = withMemberSession("Gagal menyimpan akun", async (customerId, request: Request) => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return memberError("Data tidak valid");
  const { emergencyContact, acceptWaiver } = parsed.data;
  await getPool().query(
    `UPDATE pos.pos_customers
        SET emergency_contact = CASE WHEN $2 THEN $3::jsonb ELSE emergency_contact END,
            waiver_version = CASE WHEN $4 THEN $5 ELSE waiver_version END,
            waiver_accepted_at = CASE WHEN $4 THEN now() ELSE waiver_accepted_at END,
            updated_at = now()
      WHERE id = $1`,
    [
      customerId,
      emergencyContact !== undefined,
      emergencyContact ? JSON.stringify(emergencyContact) : null,
      acceptWaiver === true,
      WAIVER_VERSION,
    ]
  );
  return memberJson({ ok: true });
});
