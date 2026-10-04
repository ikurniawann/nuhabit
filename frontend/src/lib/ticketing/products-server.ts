import "server-only";
// Master Ticket: daftar/detail/buat/ubah produk ticket dan thumbnail. Produk = satuan, paket
// (Fase P), atau season pass (EPIC-028).

import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { uploadFile } from "@/lib/storage";
import {
  bundleCompositionIssue,
  execFromClient,
  loadBundleComposition,
} from "./bundle-server";
import { resolveProductCategory } from "./categories-server";
import { RE_ENTRY_POLICIES, type TicketingContext } from "./server";
import { conflictOnDuplicate, patchAssignments, toNumberOrNull } from "./sql";
import { DEFAULT_CHANNELS_SQL } from "./venue-config-server";

type ProductKind = "single" | "bundle" | "season_pass";

export const PRODUCT_NOT_FOUND = "Ticket tidak ditemukan";

/** Kunci produk venue (FOR UPDATE) atau 404. */
export async function lockProduct<T extends Record<string, unknown>>(
  client: PoolClient,
  ctx: TicketingContext,
  id: string,
  columns: string
): Promise<T> {
  const result = await client.query<T>(
    `SELECT ${columns} FROM ticketing.ticket_products
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
     FOR UPDATE`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (result.rows.length === 0) throw ApiError.notFound(PRODUCT_NOT_FOUND);
  return result.rows[0];
}

// ── Daftar & detail ───────────────────────────────────────────────────

interface ProductListRow {
  id: string;
  code: string;
  name: string;
  category_name: string | null;
  status: "draft" | "active";
  product_kind: ProductKind;
  base_price: string;
  cogs: string;
  has_gate: boolean;
  thumbnail_url: string | null;
  variant_count: string;
  distributed_channels: string[] | null;
  updated_at: string;
}

/** Daftar ticket (Master Ticket). */
export async function listProducts(ctx: TicketingContext, q: string) {
  const params: unknown[] = [ctx.branchId, ctx.companyId];
  let where = "tp.branch_id = $1 AND tp.company_id = $2";
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (tp.name ILIKE $${params.length} OR tp.code ILIKE $${params.length})`;
  }
  const rows = await query<ProductListRow>(
    `SELECT tp.id, tp.code, tp.name, c.name AS category_name, tp.status,
            tp.product_kind, tp.base_price, tp.cogs, tp.has_gate,
            tp.thumbnail_url, tp.updated_at,
            (SELECT COUNT(*) FROM ticketing.ticket_product_variants pv
             WHERE pv.ticket_product_id = tp.id AND pv.is_active) AS variant_count,
            (SELECT array_agg(ch.code) FROM ticketing.ticket_product_channels pc
             JOIN ticketing.ticket_channels ch ON ch.id = pc.channel_id
             WHERE pc.ticket_product_id = tp.id AND pc.is_distributed)
              AS distributed_channels
     FROM ticketing.ticket_products tp
     LEFT JOIN ticketing.ticket_categories c ON c.id = tp.category_id
     WHERE ${where}
     ORDER BY tp.created_at DESC`,
    params
  );
  return rows.map((row) => ({
    ...row,
    base_price: Number(row.base_price),
    cogs: Number(row.cogs),
    variant_count: Number(row.variant_count),
    distributed_channels: row.distributed_channels ?? [],
  }));
}

interface ProductRow {
  id: string;
  code: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  status: "draft" | "active";
  product_kind: ProductKind;
  base_price: string;
  cogs: string;
  has_gate: boolean;
  thumbnail_url: string | null;
  description: string | null;
  re_entry_policy: string;
  created_at: string;
  updated_at: string;
}

interface PricedRow {
  price_regular: string | null;
  price_high: string | null;
}

const withNumericPrices = <T extends PricedRow>(row: T) => ({
  ...row,
  price_regular: toNumberOrNull(row.price_regular),
  price_high: toNumberOrNull(row.price_high),
});

/** Detail ticket + varian + kalender + distribusi kanal (+ komposisi paket). */
export async function getProductDetail(ctx: TicketingContext, id: string) {
  const product = await queryOne<ProductRow>(
    `SELECT tp.id, tp.code, tp.name, tp.category_id, c.name AS category_name,
            tp.status, tp.product_kind, tp.base_price, tp.cogs, tp.has_gate,
            tp.thumbnail_url,
            tp.description, tp.re_entry_policy, tp.created_at, tp.updated_at
     FROM ticketing.ticket_products tp
     LEFT JOIN ticketing.ticket_categories c ON c.id = tp.category_id
     WHERE tp.id = $1 AND tp.branch_id = $2 AND tp.company_id = $3`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (!product) throw ApiError.notFound(PRODUCT_NOT_FOUND);

  // Komposisi paket (kosong utk produk satuan) — komponen + status
  // kelayakannya, supaya editor bisa menampilkan peringatan
  const bundleItems =
    product.product_kind === "bundle"
      ? await query<PricedRow & Record<string, unknown>>(
          `SELECT bi.id, bi.component_variant_id, bi.qty, bi.sort_order,
                  tp.id AS component_product_id, tp.code AS component_code,
                  tp.name AS product_name, pv.name AS variant_name,
                  tp.status AS component_status,
                  pv.is_active AS variant_is_active,
                  pv.price_regular, pv.price_high
           FROM ticketing.ticket_bundle_items bi
           JOIN ticketing.ticket_product_variants pv
             ON pv.id = bi.component_variant_id
           JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
           WHERE bi.bundle_product_id = $1
           ORDER BY bi.sort_order, bi.created_at`,
          [id]
        )
      : [];

  const [variants, dates, channels] = await Promise.all([
    query<PricedRow & Record<string, unknown>>(
      `SELECT id, code, name, price_regular, price_high, sort_order, is_active
       FROM ticketing.ticket_product_variants
       WHERE ticket_product_id = $1
       ORDER BY sort_order`,
      [id]
    ),
    query(
      `SELECT id, date_kind, label, start_date::text AS start_date,
              end_date::text AS end_date, is_active
       FROM ticketing.ticket_product_dates
       WHERE ticket_product_id = $1
       ORDER BY start_date`,
      [id]
    ),
    query(
      `SELECT pc.id, ch.code AS channel_code, ch.name AS channel_name,
              ch.is_online, pc.is_distributed
       FROM ticketing.ticket_product_channels pc
       JOIN ticketing.ticket_channels ch ON ch.id = pc.channel_id
       WHERE pc.ticket_product_id = $1
       ORDER BY ch.sort_order`,
      [id]
    ),
  ]);

  return {
    product: {
      ...product,
      base_price: Number(product.base_price),
      cogs: Number(product.cogs),
    },
    variants: variants.map(withNumericPrices),
    dates,
    channels,
    bundle_items: bundleItems.map(withNumericPrices),
  };
}

// ── Buat produk ───────────────────────────────────────────────────────

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(150),
  // satuan (Adult/Child) atau paket bundling (satu varian "Paket" +
  // komposisi diatur setelah dibuat) — Fase P; season_pass — EPIC-028
  product_kind: z.enum(["single", "bundle", "season_pass"]).default("single"),
  // EPIC-028 — konfigurasi season pass (hanya dipakai bila kind=season_pass)
  validity_months: z.number().int().min(1).max(120).default(12),
  entry_policy: z
    .enum(["once_per_day", "unlimited", "limited_visits"])
    .default("once_per_day"),
  visit_quota: z.number().int().min(1).max(1000).optional().nullable(),
  // Benefit member: diskon POS utk pemegang pass aktif (0 = tanpa benefit)
  member_discount_percent: z.number().min(0).max(100).default(0),
  // Keputusan owner 2026-07-22: tiket satuan boleh Adult/Child ATAU satu
  // varian "Umum" yang berlaku semua umur — dipilih saat pembuatan
  variant_preset: z.enum(["adult-child", "umum"]).default("adult-child"),
  // kategori: pilih existing ATAU nama baru (auto-add)
  category_id: z.string().uuid().optional().nullable(),
  category_name: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["draft", "active"]).default("draft"),
  base_price: z.number().min(0).max(1_000_000_000).default(0),
  // HPP per ticket → laporan omzet kotor vs bersih
  cogs: z.number().min(0).max(1_000_000_000).default(0),
  // Ticket ber-gate divalidasi di gate; tanpa gate = reader NFC keliling
  has_gate: z.boolean().default(true),
  description: z.string().trim().max(2000).optional().nullable(),
  re_entry_policy: z.enum(RE_ENTRY_POLICIES).optional(),
});

type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * Varian default (harga kosong = wajib dilengkapi sebelum jual): paket →
 * SATU varian "Paket"; season pass atau preset "umum" → satu varian
 * "Umum"; selain itu Adult/Child. Fungsi murni.
 */
function defaultVariantsFor(
  body: Pick<CreateProductInput, "product_kind" | "variant_preset">
): { code: string; name: string; sort_order: number }[] {
  if (body.product_kind === "bundle") return [{ code: "paket", name: "Paket", sort_order: 10 }];
  if (body.variant_preset === "umum" || body.product_kind === "season_pass") {
    return [{ code: "umum", name: "Umum", sort_order: 10 }];
  }
  return [
    { code: "adult", name: "Adult", sort_order: 10 },
    { code: "child", name: "Child", sort_order: 20 },
  ];
}

/**
 * Buat ticket baru: kode auto TKT-#### per venue, varian default (lihat
 * defaultVariantsFor), distribusi default walk-in ON / website OFF
 * (diatur ulang di Channel Manager).
 */
export async function createProduct(
  ctx: TicketingContext,
  body: CreateProductInput
): Promise<{ id: string; code: string }> {
  // Paket baru wajib Draft: belum ada komposisi, belum boleh dijual
  if (body.product_kind === "bundle" && body.status === "active") {
    throw ApiError.badRequest("Paket baru wajib berstatus Draft — lengkapi komposisi dulu");
  }
  // EPIC-028 — pass punch-card WAJIB kuota; policy lain kuota diabaikan
  if (
    body.product_kind === "season_pass" &&
    body.entry_policy === "limited_visits" &&
    (!body.visit_quota || body.visit_quota <= 0)
  ) {
    throw ApiError.badRequest(
      "Kuota kunjungan wajib diisi untuk pass jenis punch-card (jatah kunjungan)"
    );
  }

  const work = withTransaction(async (client) => {
    // Default venue utk kebijakan re-entry ticket baru
    const settingsResult = await client.query<{ re_entry_policy: string }>(
      `SELECT re_entry_policy FROM ticketing.ticket_settings
       WHERE branch_id = $1 AND company_id = $2`,
      [ctx.branchId, ctx.companyId]
    );
    const reEntry =
      body.re_entry_policy ?? settingsResult.rows[0]?.re_entry_policy ?? "sekali-masuk";

    const categoryId =
      (await resolveProductCategory(client, ctx, body.category_id ?? undefined, body.category_name)) ??
      null;

    // Kode auto per venue (admin action jarang — MAX cukup, unique
    // constraint jadi jaring pengaman race)
    const codeResult = await client.query<{ next: string }>(
      `SELECT COALESCE(MAX(NULLIF(substring(code from 5), '')::int), 0) + 1 AS next
       FROM ticketing.ticket_products
       WHERE branch_id = $1 AND code ~ '^TKT-[0-9]+$'`,
      [ctx.branchId]
    );
    const code = `TKT-${String(Number(codeResult.rows[0].next)).padStart(4, "0")}`;

    const productResult = await client.query<{ id: string }>(
      `INSERT INTO ticketing.ticket_products
         (company_id, branch_id, code, name, category_id, status,
          product_kind, base_price, cogs, has_gate, description,
          re_entry_policy, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        ctx.companyId,
        ctx.branchId,
        code,
        body.name,
        categoryId,
        body.status,
        body.product_kind,
        body.base_price,
        body.cogs,
        body.has_gate,
        body.description || null,
        reEntry,
        ctx.user.id,
      ]
    );
    const productId = productResult.rows[0].id;

    for (const variant of defaultVariantsFor(body)) {
      await client.query(
        `INSERT INTO ticketing.ticket_product_variants
           (company_id, branch_id, ticket_product_id, code, name, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ctx.companyId, ctx.branchId, productId, variant.code, variant.name, variant.sort_order]
      );
    }

    // EPIC-028 — konfigurasi season pass (1:1 dengan produk)
    if (body.product_kind === "season_pass") {
      await client.query(
        `INSERT INTO ticketing.ticket_pass_configs
           (company_id, branch_id, ticket_product_id, validity_months,
            entry_policy, visit_quota, member_discount_percent, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          ctx.companyId,
          ctx.branchId,
          productId,
          body.validity_months,
          body.entry_policy,
          body.entry_policy === "limited_visits" ? body.visit_quota : null,
          body.member_discount_percent,
          ctx.user.id,
        ]
      );
    }

    // Pastikan kanal venue ada, lalu distribusi default
    await client.query(DEFAULT_CHANNELS_SQL, [ctx.companyId, ctx.branchId, ctx.user.id]);
    await client.query(
      `INSERT INTO ticketing.ticket_product_channels
         (company_id, branch_id, ticket_product_id, channel_id, is_distributed)
       SELECT $1, $2, $3, ch.id, (ch.code = 'walk-in')
       FROM ticketing.ticket_channels ch
       WHERE ch.branch_id = $2 AND ch.company_id = $1
       ON CONFLICT (ticket_product_id, channel_id) DO NOTHING`,
      [ctx.companyId, ctx.branchId, productId]
    );

    return { id: productId, code };
  });
  // Tabrakan kode auto (unique branch+code) — sangat jarang, arahkan retry
  return conflictOnDuplicate(work, "Tabrakan kode ticket — coba simpan sekali lagi");
}

// ── Ubah produk ───────────────────────────────────────────────────────

const priceSchema = z.number().min(0).max(1_000_000_000).nullable();

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  category_id: z.string().uuid().optional().nullable(),
  category_name: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["draft", "active"]).optional(),
  base_price: z.number().min(0).max(1_000_000_000).optional(),
  cogs: z.number().min(0).max(1_000_000_000).optional(),
  has_gate: z.boolean().optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  re_entry_policy: z.enum(RE_ENTRY_POLICIES).optional(),
  variants: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(60).optional(),
        price_regular: priceSchema.optional(),
        price_high: priceSchema.optional(),
        is_active: z.boolean().optional(),
      })
    )
    .max(10)
    .optional(),
});

export async function updateProduct(
  ctx: TicketingContext,
  id: string,
  body: z.infer<typeof updateProductSchema>
): Promise<void> {
  await withTransaction(async (client) => {
    const existing = await client.query<{ id: string; product_kind: ProductKind }>(
      `SELECT id, product_kind FROM ticketing.ticket_products
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
       FOR UPDATE`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (existing.rows.length === 0) throw ApiError.notFound(PRODUCT_NOT_FOUND);

    // Paket hanya boleh naik Active bila komposisinya layak jual
    // (ada isi, semua komponen tiket satuan Active ber-varian aktif)
    if (body.status === "active" && existing.rows[0].product_kind === "bundle") {
      const composition = await loadBundleComposition(execFromClient(client), {
        companyId: ctx.companyId,
        branchId: ctx.branchId,
        bundleProductId: id,
      });
      const issue = bundleCompositionIssue(composition);
      if (issue) throw ApiError.badRequest(`Paket belum bisa diaktifkan: ${issue}`);
    }

    const categoryId = await resolveProductCategory(
      client,
      ctx,
      body.category_id,
      body.category_name
    );

    const product = patchAssignments(
      {
        name: body.name,
        category_id: categoryId,
        status: body.status,
        base_price: body.base_price,
        cogs: body.cogs,
        has_gate: body.has_gate,
        description: body.description === undefined ? undefined : body.description || null,
        re_entry_policy: body.re_entry_policy,
      },
      1
    );
    if (product.values.length > 0) {
      await client.query(
        `UPDATE ticketing.ticket_products
         SET ${["updated_at = now()", ...product.assignments].join(", ")}
         WHERE id = $1`,
        [id, ...product.values]
      );
    }

    // Turun ke Draft = tidak boleh tetap terdistribusi. Registrasi loket
    // sudah menolak produk Draft, tapi papan Channel Manager jangan
    // memperlihatkan toggle "menyala" yang sebetulnya mati (hasil review).
    if (body.status === "draft") {
      await client.query(
        `UPDATE ticketing.ticket_product_channels
         SET is_distributed = false, updated_at = now()
         WHERE ticket_product_id = $1 AND is_distributed = true`,
        [id]
      );
    }

    for (const variant of body.variants ?? []) {
      const { assignments, values } = patchAssignments(
        {
          name: variant.name,
          price_regular: variant.price_regular,
          price_high: variant.price_high,
          is_active: variant.is_active,
        },
        2
      );
      if (values.length === 0) continue;
      await client.query(
        `UPDATE ticketing.ticket_product_variants
         SET ${["updated_at = now()", ...assignments].join(", ")}
         WHERE id = $1 AND ticket_product_id = $2`,
        [variant.id, id, ...values]
      );
    }
  });
}

// ── Thumbnail ─────────────────────────────────────────────────────────

const MAX_THUMBNAIL_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Unggah thumbnail ticket — gambar saja, maks 3 MB (pola foto member). */
export async function uploadProductThumbnail(
  ctx: TicketingContext,
  id: string,
  file: FormDataEntryValue | null
): Promise<string> {
  const product = await queryOne<{ id: string }>(
    `SELECT id FROM ticketing.ticket_products
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (!product) throw ApiError.notFound(PRODUCT_NOT_FOUND);

  if (!(file instanceof File) || file.size === 0) {
    throw ApiError.badRequest("Gambar tidak ditemukan");
  }
  if (file.size > MAX_THUMBNAIL_BYTES) throw ApiError.badRequest("Ukuran gambar maksimal 3 MB");
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw ApiError.badRequest("Format harus JPG, PNG, atau WEBP");
  }

  const { url, error } = await uploadFile("ticketing", file, ctx.branchId);
  if (error || !url) {
    console.error("[ticketing] upload thumbnail gagal:", error);
    throw ApiError.server("Gagal mengunggah gambar");
  }
  await query(
    `UPDATE ticketing.ticket_products
     SET thumbnail_url = $2, updated_at = now()
     WHERE id = $1`,
    [id, url]
  );
  return url;
}
