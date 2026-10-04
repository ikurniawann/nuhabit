import "server-only";
// Registrasi kunjungan walk-in di loket: gelang satuan + pembelian paket
// (Fase P), mode bayar postpaid/prepaid, deposit awal. Satu transaksi:
// kuota harian → kanal walk-in → kunci gelang → validasi varian/paket →
// insert visit + visit_bands + deposit.

import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { todayInJakarta } from "./booking";
import { allocateBundlePrice, expandBundleMembers } from "./bundle";
import {
  bundleCompositionIssue,
  execFromClient,
  loadBundleComposition,
  toBundleComponents,
} from "./bundle-server";
import { assertCapacityAvailable } from "./capacity-server";
import { resolveVariantPriceOnDate } from "./pricing-server";
import {
  CASH_METHODS,
  PAYMENT_MODES,
  normalizeNfcUid,
  requireDistinctNfcUids,
  type TicketingContext,
} from "./server";

export const registerVisitSchema = z.object({
  contact_name: z.string().trim().min(1).max(150),
  contact_phone: z.string().trim().max(30).optional().nullable(),
  payment_mode: z.enum(PAYMENT_MODES),
  // plafon khusus visit ini; kosong = default venue dari ticket_settings
  credit_limit: z.number().min(0).max(1_000_000_000).optional().nullable(),
  deposit: z
    .object({
      amount: z.number().positive().max(1_000_000_000),
      method: z.enum(CASH_METHODS),
    })
    .optional()
    .nullable(),
  bands: z
    .array(
      z.object({
        nfc_uid: z.string().trim().min(1).max(80),
        variant_id: z.string().uuid(),
      })
    )
    .max(50)
    .default([]),
  // Fase P — pembelian paket: 1 entri = 1 unit paket; band_uids urut
  // mengikuti urutan anggota komposisi (server yang memetakan varian
  // komponen — klien tidak menentukan harga/varian per gelang)
  bundles: z
    .array(
      z.object({
        bundle_variant_id: z.string().uuid(),
        band_uids: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
      })
    )
    .max(10)
    .default([]),
});

type RegisterVisitInput = z.infer<typeof registerVisitSchema>;

/** Default plafon postpaid bila venue belum punya baris settings. */
const FALLBACK_CREDIT_LIMIT = 500000;

interface LockedBand {
  id: string;
  nfc_uid: string;
  status: string;
}

/**
 * Kunci gelang deterministik (ORDER BY id — hindari deadlock); semua UID
 * wajib terdaftar dan berstatus 'tersedia'. Dipakai registrasi & redeem.
 */
export async function lockAvailableBands(
  client: PoolClient,
  ctx: TicketingContext,
  uids: readonly string[]
): Promise<Map<string, LockedBand>> {
  const result = await client.query<LockedBand>(
    `SELECT id, nfc_uid, status FROM ticketing.ticket_bands
     WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = ANY($3)
     ORDER BY id
     FOR UPDATE`,
    [ctx.branchId, ctx.companyId, uids]
  );
  const bandByUid = new Map(result.rows.map((b) => [b.nfc_uid, b]));
  for (const uid of uids) {
    const band = bandByUid.get(uid);
    if (!band) throw ApiError.badRequest(`Gelang ${uid} belum terdaftar di registry`);
    if (band.status !== "tersedia") {
      throw ApiError.conflict(`Gelang ${uid} berstatus "${band.status}" — tidak bisa dipakai`);
    }
  }
  return bandByUid;
}

interface PreparedBundleBand {
  uid: string;
  component_variant_id: string;
  bundle_product_id: string;
  bundle_unit_no: number;
  allocated_price: number;
  member_label: string;
}

/**
 * Fase P — pembelian paket: resolve harga paket HARI INI di kanal walk-in
 * lalu prorata ke anggota; harga alokasi di-snapshot di visit_bands
 * supaya gate tap tinggal men-charge tanpa resolve ulang.
 */
async function prepareBundleBands(
  client: PoolClient,
  ctx: TicketingContext,
  channelId: string,
  bundles: RegisterVisitInput["bundles"]
): Promise<PreparedBundleBand[]> {
  if (bundles.length === 0) return [];
  const visitDate = todayInJakarta();
  const exec = execFromClient(client);
  const bundleVariantIds = [...new Set(bundles.map((bu) => bu.bundle_variant_id))];
  const bundleVariantsResult = await client.query<{
    id: string;
    ticket_product_id: string;
    bundle_name: string;
  }>(
    `SELECT pv.id, pv.ticket_product_id, tp.name AS bundle_name
     FROM ticketing.ticket_product_variants pv
     JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
     JOIN ticketing.ticket_product_channels pc
       ON pc.ticket_product_id = tp.id AND pc.channel_id = $4
          AND pc.is_distributed = true
     WHERE pv.branch_id = $1 AND pv.company_id = $2 AND pv.id = ANY($3)
       AND pv.is_active = true AND tp.status = 'active'
       AND tp.product_kind = 'bundle'`,
    [ctx.branchId, ctx.companyId, bundleVariantIds, channelId]
  );
  const bundleVariantById = new Map(bundleVariantsResult.rows.map((r) => [r.id, r]));
  if (bundleVariantById.size !== bundleVariantIds.length) {
    throw ApiError.badRequest("Ada paket yang tidak dikenal / nonaktif / belum didistribusi ke POS");
  }

  const prepared: PreparedBundleBand[] = [];
  let unitNo = 0;
  for (const purchase of bundles) {
    const bundleVariant = bundleVariantById.get(purchase.bundle_variant_id)!;
    const composition = await loadBundleComposition(exec, {
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      bundleProductId: bundleVariant.ticket_product_id,
    });
    const issue = bundleCompositionIssue(composition);
    if (issue) {
      throw ApiError.badRequest(`Paket "${bundleVariant.bundle_name}" tidak layak jual: ${issue}`);
    }

    const resolved = await resolveVariantPriceOnDate(client, {
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      variantId: purchase.bundle_variant_id,
      channelId,
      visitDate,
    });
    if (!resolved.ok) {
      throw ApiError.badRequest(
        `Harga paket "${bundleVariant.bundle_name}" belum diisi — lengkapi di Master Ticket`
      );
    }

    const members = expandBundleMembers(toBundleComponents(composition, resolved.seasonKind));
    if (purchase.band_uids.length !== members.length) {
      throw ApiError.badRequest(
        `Paket "${bundleVariant.bundle_name}" butuh ${members.length} gelang per unit — di-tap ${purchase.band_uids.length}`
      );
    }
    const shares = allocateBundlePrice(
      resolved.price,
      members.map((m) => m.weight_price)
    );
    unitNo += 1;
    members.forEach((member, index) => {
      prepared.push({
        uid: normalizeNfcUid(purchase.band_uids[index]),
        component_variant_id: member.component_variant_id,
        bundle_product_id: bundleVariant.ticket_product_id,
        bundle_unit_no: unitNo,
        allocated_price: shares[index],
        member_label: `${bundleVariant.bundle_name} — ${member.member_label}`,
      });
    });
  }
  return prepared;
}

export async function registerVisit(
  ctx: TicketingContext,
  body: RegisterVisitInput
): Promise<string> {
  if (body.bands.length === 0 && body.bundles.length === 0) {
    throw ApiError.badRequest("Minimal satu gelang harus di-tap");
  }
  // Semua UID (satuan + anggota paket) dinormalisasi & unik global
  const uids = requireDistinctNfcUids([
    ...body.bands.map((b) => b.nfc_uid),
    ...body.bundles.flatMap((bu) => bu.band_uids),
  ]);
  if (body.payment_mode === "prepaid" && !body.deposit) {
    throw ApiError.badRequest("Mode prepaid wajib top-up deposit awal");
  }

  return withTransaction(async (client) => {
    // EPIC-031 B2 — kuota harian juga mengikat walk-in (keputusan owner
    // 25 Jul): 1 gelang = 1 orang, tanggal = hari ini WIB. Redeem booking
    // TIDAK lewat sini (kuotanya sudah dipegang bookingnya). Fail-closed
    // tanpa override supervisor; unlimited = no-op tanpa lock.
    await assertCapacityAvailable(
      client,
      { companyId: ctx.companyId, branchId: ctx.branchId },
      todayInJakarta(),
      uids.length
    );
    const settingsResult = await client.query<{ default_credit_limit: string }>(
      `SELECT default_credit_limit FROM ticketing.ticket_settings
       WHERE branch_id = $1 AND company_id = $2`,
      [ctx.branchId, ctx.companyId]
    );
    const defaultLimit = settingsResult.rows[0]
      ? Number(settingsResult.rows[0].default_credit_limit)
      : FALLBACK_CREDIT_LIMIT;

    const channelResult = await client.query<{ id: string }>(
      `SELECT id FROM ticketing.ticket_channels
       WHERE branch_id = $1 AND company_id = $2 AND code = 'walk-in'
         AND is_active = true`,
      [ctx.branchId, ctx.companyId]
    );
    if (channelResult.rows.length === 0) {
      throw ApiError.badRequest("Kanal walk-in belum aktif — buka Pengaturan Tiket dulu");
    }
    const channelId = channelResult.rows[0].id;

    const bandByUid = await lockAvailableBands(client, ctx, uids);

    // Varian satuan valid = milik venue, aktif, produk SATUAN Active
    // DAN terdistribusi ke kanal walk-in (Channel Manager); varian
    // paket tidak boleh menempel langsung ke satu gelang
    const variantIds = [...new Set(body.bands.map((b) => b.variant_id))];
    if (variantIds.length > 0) {
      const variantsResult = await client.query<{ id: string }>(
        `SELECT pv.id
         FROM ticketing.ticket_product_variants pv
         JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
         JOIN ticketing.ticket_product_channels pc
           ON pc.ticket_product_id = tp.id AND pc.channel_id = $4
              AND pc.is_distributed = true
         WHERE pv.branch_id = $1 AND pv.company_id = $2 AND pv.id = ANY($3)
           AND pv.is_active = true AND tp.status = 'active'
           AND tp.product_kind = 'single'`,
        [ctx.branchId, ctx.companyId, variantIds, channelId]
      );
      if (variantsResult.rows.length !== variantIds.length) {
        throw ApiError.badRequest(
          "Ada varian ticket yang tidak dikenal / nonaktif / belum didistribusi ke POS"
        );
      }
    }

    const bundleBands = await prepareBundleBands(client, ctx, channelId, body.bundles);

    const visitResult = await client.query<{ id: string }>(
      `INSERT INTO ticketing.ticket_visits
         (company_id, branch_id, contact_name, contact_phone, channel_id,
          payment_mode, credit_limit, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        ctx.companyId,
        ctx.branchId,
        body.contact_name,
        body.contact_phone || null,
        channelId,
        body.payment_mode,
        body.payment_mode === "postpaid" ? (body.credit_limit ?? defaultLimit) : null,
        ctx.user.id,
      ]
    );
    const visitId = visitResult.rows[0].id;

    const markBandInUse = (bandId: string) =>
      client.query(
        `UPDATE ticketing.ticket_bands
         SET status = 'dipakai', updated_at = now()
         WHERE id = $1`,
        [bandId]
      );

    for (const item of body.bands) {
      const band = bandByUid.get(normalizeNfcUid(item.nfc_uid))!;
      await client.query(
        `INSERT INTO ticketing.ticket_visit_bands
           (company_id, branch_id, visit_id, band_id, variant_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [ctx.companyId, ctx.branchId, visitId, band.id, item.variant_id]
      );
      await markBandInUse(band.id);
    }

    // Anggota paket: gelang menunjuk varian KOMPONEN + snapshot alokasi
    for (const member of bundleBands) {
      const band = bandByUid.get(member.uid)!;
      await client.query(
        `INSERT INTO ticketing.ticket_visit_bands
           (company_id, branch_id, visit_id, band_id, variant_id,
            bundle_product_id, bundle_unit_no, allocated_price, member_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          ctx.companyId,
          ctx.branchId,
          visitId,
          band.id,
          member.component_variant_id,
          member.bundle_product_id,
          member.bundle_unit_no,
          member.allocated_price,
          member.member_label,
        ]
      );
      await markBandInUse(band.id);
    }

    if (body.payment_mode === "prepaid" && body.deposit) {
      await client.query(
        `INSERT INTO ticketing.ticket_visit_charges
           (company_id, branch_id, visit_id, charge_type, direction,
            description, amount, payment_method, created_by)
         VALUES ($1, $2, $3, 'deposit', 'kredit', $4, $5, $6, $7)`,
        [
          ctx.companyId,
          ctx.branchId,
          visitId,
          `Top-up deposit awal (${body.deposit.method})`,
          Math.round(body.deposit.amount * 100) / 100,
          body.deposit.method,
          ctx.user.id,
        ]
      );
    }

    return visitId;
  });
}
