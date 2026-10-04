/**
 * EPIC-050 Fase 1 (T-1.1/T-1.3) — jaga tautan lead ↔ account/contact.
 *
 * Lead lama & form lead yang ada masih memakai org_name + PIC inline. Supaya
 * Account/Contact selalu terisi tanpa memaksa user mengisi dua kali, setiap
 * lead yang dibuat/diubah di-upsert ke crm_accounts (by company + nama,
 * case-insensitive) dan crm_contacts (by company + nomor WA), lalu lead-nya
 * ditautkan. Logika sama dengan migrasi data 20260913100000 (bagian 4).
 */
import { query, queryOne } from "@/lib/db";

type LeadForSync = {
  id: string;
  company_id: string;
  branch_id: string;
  org_name: string;
  org_type: string;
  pic_name: string;
  pic_title: string | null;
  pic_phone: string;
  pic_email: string | null;
  city: string | null;
  owner_user_id: string | null;
  customer_id: string | null;
  created_by: string | null;
  account_id: string | null;
  contact_id: string | null;
};

export async function syncLeadAccountContact(
  leadId: string
): Promise<{ account_id: string | null; contact_id: string | null }> {
  const lead = await queryOne<LeadForSync>(
    `SELECT id, company_id, branch_id, org_name, org_type, pic_name, pic_title,
            pic_phone, pic_email, city, owner_user_id, customer_id, created_by,
            account_id, contact_id
     FROM crm.crm_sales_leads WHERE id = $1 AND deleted_at IS NULL`,
    [leadId]
  );
  if (!lead) return { account_id: null, contact_id: null };

  // ── Account: cocokkan nama (case-insensitive) di company yang sama ──
  let accountId = lead.account_id;
  const existingAccount = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_accounts
     WHERE company_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`,
    [lead.company_id, lead.org_name]
  );
  if (existingAccount) {
    accountId = existingAccount.id;
  } else if (!accountId) {
    const created = await queryOne<{ id: string }>(
      `INSERT INTO crm.crm_accounts
         (company_id, branch_id, name, account_type, city, owner_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [lead.company_id, lead.branch_id, lead.org_name, lead.org_type, lead.city, lead.owner_user_id, lead.created_by]
    );
    accountId = created?.id ?? null;
  } else {
    // nama lead berubah → ikuti nama baru pada account yang sudah tertaut
    await query(
      `UPDATE crm.crm_accounts SET name = $2, account_type = $3, city = COALESCE(city, $4), updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM crm.crm_accounts x WHERE x.company_id = $5 AND lower(x.name) = lower($2) AND x.id <> $1 AND x.deleted_at IS NULL)`,
      [accountId, lead.org_name, lead.org_type, lead.city, lead.company_id]
    );
  }

  // ── Contact: cocokkan nomor WA di company yang sama ──
  let contactId = lead.contact_id;
  const existingContact = await queryOne<{ id: string; account_id: string | null }>(
    `SELECT id, account_id FROM crm.crm_contacts
     WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL`,
    [lead.company_id, lead.pic_phone]
  );
  if (existingContact) {
    contactId = existingContact.id;
    // isi data yang masih kosong; account hanya diisi bila contact belum punya
    await query(
      `UPDATE crm.crm_contacts
         SET name = COALESCE(NULLIF(name, ''), $2),
             title = COALESCE(title, $3),
             email = COALESCE(email, NULLIF($4, '')),
             customer_id = COALESCE(customer_id, $5),
             account_id = COALESCE(account_id, $6),
             updated_at = now()
       WHERE id = $1`,
      [contactId, lead.pic_name, lead.pic_title, lead.pic_email, lead.customer_id, accountId]
    );
  } else {
    const created = await queryOne<{ id: string }>(
      `INSERT INTO crm.crm_contacts
         (company_id, branch_id, account_id, name, title, phone, email, is_primary,
          customer_id, owner_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''),
               NOT EXISTS (SELECT 1 FROM crm.crm_contacts c WHERE c.account_id = $3 AND c.deleted_at IS NULL AND c.is_primary),
               $8, $9, $10)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        lead.company_id,
        lead.branch_id,
        accountId,
        lead.pic_name,
        lead.pic_title,
        lead.pic_phone,
        lead.pic_email,
        lead.customer_id,
        lead.owner_user_id,
        lead.created_by,
      ]
    );
    contactId = created?.id ?? contactId;
  }

  if (accountId !== lead.account_id || contactId !== lead.contact_id) {
    await query(
      `UPDATE crm.crm_sales_leads SET account_id = $2, contact_id = $3, updated_at = now() WHERE id = $1`,
      [leadId, accountId, contactId]
    );
  }
  return { account_id: accountId, contact_id: contactId };
}
