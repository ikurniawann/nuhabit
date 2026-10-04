import type { Pool, PoolClient } from "pg";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";

/**
 * Persetujuan promo member. Dua tempat harus selaras: pos_customers.wa_consent
 * (dibaca portal & profil) dan crm.crm_marketing_optouts (yang dipakai
 * kampanye WA untuk mengecualikan penerima). Member yang mematikan promo
 * masuk daftar opt-out venue default dengan source 'portal'; menyalakannya
 * kembali menghapus opt-out nomor itu di semua venue.
 */

type Db = Pool | PoolClient;

/** Ekspresi SQL: digit nomor dengan awalan 0 diganti 62, supaya 08xx = 628xx. */
const canonical = (column: string) =>
  `regexp_replace(regexp_replace(${column}, '\\D', '', 'g'), '^0', '62')`;

export async function setMarketingConsent(db: Db, customerId: string, enabled: boolean): Promise<void> {
  const { rows } = await db.query(
    `UPDATE pos.pos_customers SET wa_consent = $2, updated_at = now()
      WHERE id = $1 RETURNING regexp_replace(phone, '\\D', '', 'g') AS digits`,
    [customerId, enabled]
  );
  const digits: string | undefined = rows[0]?.digits;
  if (!digits) return;

  if (enabled) {
    await db.query(
      `DELETE FROM crm.crm_marketing_optouts WHERE ${canonical("phone")} = ${canonical("$1::text")}`,
      [digits]
    );
    return;
  }
  const venue = await getCrmDefaultVenue(createPgClient());
  if (!venue.companyId || !venue.branchId) return;
  // Disimpan dengan digit persis seperti nomor member: kampanye mencocokkan
  // opt-out dengan membandingkan digit mentah kedua kolom.
  await db.query(
    `INSERT INTO crm.crm_marketing_optouts (company_id, branch_id, phone, customer_id, source, note)
     VALUES ($2, $3, $1, $4, 'portal', 'Dimatikan member lewat portal')
     ON CONFLICT (branch_id, phone) DO NOTHING`,
    [digits, venue.companyId, venue.branchId, customerId]
  );
}

/** True bila member setuju promo DAN nomornya tidak ada di daftar opt-out mana pun. */
export async function readMarketingConsent(db: Db, customerId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT c.wa_consent,
            EXISTS (SELECT 1 FROM crm.crm_marketing_optouts o
                     WHERE ${canonical("o.phone")} = ${canonical("c.phone")}) AS opted_out
       FROM pos.pos_customers c WHERE c.id = $1`,
    [customerId]
  );
  return rows[0]?.wa_consent === true && rows[0]?.opted_out !== true;
}
