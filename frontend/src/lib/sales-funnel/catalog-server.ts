import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { query, queryOne, withTransaction } from "@/lib/db";
import { normalizePhone } from "./server";
import { createUpdateSet, createWhere } from "./sql";

/**
 * Data pendukung form sales-funnel: penanggung jawab, katalog produk,
 * pencarian member/bahan baku, alasan kalah, template WA, resep produk.
 */

/** User yang bisa jadi penanggung jawab/approver (sales, admin, super_admin, …) di scope. */
export async function listOwners(companyId: string | null) {
  return query(
    `SELECT id, full_name, role, company_id FROM configuration.users
     WHERE status = 'active' AND role IN ('sales', 'admin', 'super_admin', 'marketing', 'hrd')
       AND ($1::uuid IS NULL OR company_id IS NULL OR company_id = $1)
     ORDER BY role, full_name LIMIT 200`,
    [companyId]
  );
}

export async function listLostReasons() {
  return query(
    `SELECT id, code, name, sort_order FROM crm.crm_sales_lost_reasons
     WHERE is_active = true
     ORDER BY sort_order ASC, created_at ASC`
  );
}

/** Katalog quotation = pos_products aktif (keputusan owner Fase F1). */
export async function listCatalogProducts() {
  return query(
    `SELECT id, name, base_price
     FROM pos.pos_products
     WHERE is_active = true
     ORDER BY name ASC
     LIMIT 200`
  );
}

/** Member loyalty untuk penautan PIC — pos_customers global by design (EPIC-011). */
export async function searchCustomers(q: string) {
  if (q.length < 3) return [];
  const byPhone = normalizePhone(q);
  return query(
    `SELECT id, name, phone, membership_tier
     FROM pos.pos_customers
     WHERE is_active = true
       AND (name ILIKE $1 OR phone LIKE $2)
     ORDER BY name ASC
     LIMIT 10`,
    [`%${q}%`, `%${byPhone.length >= 5 ? byPhone : q}%`]
  );
}

/** raw_materials BER-tenant — wajib difilter scope (temuan HIGH gate F3). */
export async function searchRawMaterials(q: string, scope: UserScope | null) {
  if (q.length < 2) return [];
  const where = createWhere(["rm.is_active = true", "rm.deleted_at IS NULL"]);
  const like = where.param(`%${q}%`);
  where.push(`(rm.nama ILIKE ${like} OR rm.kode ILIKE ${like})`);
  if (scope?.companyId) where.add("(rm.company_id IS NULL OR rm.company_id = ?)", scope.companyId);
  if (scope?.businessScope === "branch" && scope.branchId) {
    where.add("(rm.branch_id IS NULL OR rm.branch_id = ?)", scope.branchId);
  }
  return query(
    `SELECT rm.id, rm.kode, rm.nama, u.nama AS satuan_kecil
     FROM item.raw_materials rm
     LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
     WHERE ${where.sql()}
     ORDER BY rm.nama ASC
     LIMIT 20`,
    where.params
  );
}

// ── Template WA (global, company_id NULL — kelola super_admin) ──

export const waTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(2000),
});
export const updateWaTemplateSchema = waTemplateSchema.partial();

export async function listWaTemplates() {
  return query(
    `SELECT id, name, body, is_active, created_at
     FROM crm.crm_sales_wa_templates
     WHERE is_active = true
     ORDER BY name ASC`
  );
}

export async function createWaTemplate(input: z.infer<typeof waTemplateSchema>, userId: string) {
  return queryOne(
    `INSERT INTO crm.crm_sales_wa_templates (name, body, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, name, body, is_active`,
    [input.name, input.body, userId]
  );
}

export async function updateWaTemplate(id: string, input: z.infer<typeof updateWaTemplateSchema>) {
  const update = createUpdateSet();
  update.setAll(input);
  const { sql, values, idParam } = update.build(id);
  const row = await queryOne(
    `UPDATE crm.crm_sales_wa_templates SET ${sql}
     WHERE id = ${idParam} AND is_active = true
     RETURNING id, name, body, is_active`,
    values
  );
  if (!row) throw ApiError.notFound("Template tidak ditemukan");
  return row;
}

/** Nonaktifkan, bukan hapus — riwayat kirim tetap bisa dirunut. */
export async function deactivateWaTemplate(id: string): Promise<void> {
  const row = await queryOne(
    `UPDATE crm.crm_sales_wa_templates
     SET is_active = false, updated_at = now()
     WHERE id = $1 AND is_active = true RETURNING id`,
    [id]
  );
  if (!row) throw ApiError.notFound("Template tidak ditemukan");
}

// ── Resep produk (BOM per 1 unit/pax, Fase F3) ──

export const putRecipeSchema = z.object({
  product_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        raw_material_id: z.string().uuid(),
        quantity_per_unit: z.number().positive().max(1_000_000),
        waste_percentage: z.number().min(0).max(100).default(0),
      })
    )
    .max(50),
});

export async function getRecipe(productId: string) {
  return query(
    `SELECT r.id, r.raw_material_id, r.quantity_per_unit,
            r.unit_of_measure, r.waste_percentage,
            rm.kode AS material_kode, rm.nama AS material_nama,
            u.nama AS satuan_kecil
     FROM pos.pos_recipes r
     JOIN item.raw_materials rm ON rm.id = r.raw_material_id
     LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
     WHERE r.product_id = $1 AND r.is_active = true
     ORDER BY rm.nama ASC`,
    [productId]
  );
}

/** Ganti seluruh resep sebuah produk. */
export async function replaceRecipe({ product_id, items }: z.infer<typeof putRecipeSchema>) {
  const uniqueMaterials = new Set(items.map((item) => item.raw_material_id));
  if (uniqueMaterials.size !== items.length) {
    throw ApiError.badRequest("Ada bahan baku yang dobel dalam resep");
  }

  await withTransaction(async (client) => {
    const product = await client.query(
      `SELECT id FROM pos.pos_products WHERE id = $1 AND is_active = true`,
      [product_id]
    );
    if (product.rowCount === 0) throw ApiError.badRequest("Produk tidak ditemukan");

    // Satuan resep DITURUNKAN server dari satuan kecil bahan (kolom NOT NULL
    // varchar(20)); satuan beda dari unit stok membuat realisasi meleset
    // diam-diam (temuan HIGH + MEDIUM gate F3). Input klien diabaikan.
    // Endpoint super_admin-only: resep global mengikuti pos_products tanpa kolom tenant.
    const unitByMaterial = new Map<string, string>();
    if (items.length > 0) {
      const materials = await client.query<{ id: string; satuan: string }>(
        `SELECT rm.id, LEFT(COALESCE(u.nama, 'unit'), 20) AS satuan
         FROM item.raw_materials rm
         LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
         WHERE rm.id = ANY($1::uuid[]) AND rm.is_active = true
           AND rm.deleted_at IS NULL`,
        [[...uniqueMaterials]]
      );
      if (materials.rowCount !== uniqueMaterials.size) {
        throw ApiError.badRequest("Ada bahan baku yang tidak ditemukan atau nonaktif");
      }
      for (const row of materials.rows) unitByMaterial.set(row.id, row.satuan);
    }

    await client.query(`DELETE FROM pos.pos_recipes WHERE product_id = $1`, [product_id]);
    for (const item of items) {
      await client.query(
        `INSERT INTO pos.pos_recipes
           (product_id, raw_material_id, quantity_per_unit,
            unit_of_measure, waste_percentage, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [
          product_id,
          item.raw_material_id,
          item.quantity_per_unit,
          unitByMaterial.get(item.raw_material_id) ?? "unit",
          item.waste_percentage,
        ]
      );
    }
  });
  return { product_id, items: items.length };
}
