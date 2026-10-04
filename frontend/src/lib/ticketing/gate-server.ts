import "server-only";
// Tap gelang di gate. Tap pertama yang lolos guard men-charge tiket ke tab
// (harga snapshot hasil resolve matriks hari ini); tap ulang mengikuti
// kebijakan re-entry ticket. Semua tap — diterima maupun ditolak —
// tercatat di ticket_gate_events.

import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import { todayInJakarta } from "./booking";
import { resolveVariantPriceOnDate } from "./pricing-server";
import type { TicketingContext } from "./server";
import { canCharge, computeTabSummary } from "./tab";

export type GateTapResult =
  | "masuk"
  | "masuk-lagi"
  | "masuk-karyawan"
  | "ditolak-gelang-tak-dikenal"
  | "ditolak-tanpa-kunjungan"
  | "ditolak-sudah-masuk"
  | "ditolak-saldo-kurang"
  | "ditolak-plafon"
  | "ditolak-tanpa-kanal"
  | "ditolak-harga-belum-diisi"
  | "ditolak-karyawan-nonaktif";

export interface GateTapOutcome {
  result: GateTapResult;
  ok: boolean;
  reason?: string;
  contact_name?: string;
  ticket_type_name?: string;
  /** Nama anggota rombongan booking (NULL utk walk-in). */
  guest_name?: string | null;
  band_label?: string | null;
  charged_amount?: number;
}

interface ActiveVisitBand {
  visit_band_id: string;
  visit_id: string;
  variant_id: string;
  guest_name: string | null;
  ticket_product_id: string;
  ticket_type_name: string;
  re_entry_policy: string;
  entered_at: string | null;
  contact_name: string;
  payment_mode: "postpaid" | "prepaid";
  credit_limit: string | null;
  channel_id: string | null;
  visit_status: string;
  allocated_price: string | null;
  member_label: string | null;
  bundle_product_id: string | null;
}

type TicketCharge =
  | { ok: true; amount: number; description: string; priceContext: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Harga tiket tap pertama. Anggota paket walk-in (Fase P): harga alokasi
 * sudah di-snapshot saat registrasi → charge langsung TANPA resolve
 * matriks (master berubah ≠ tagihan berubah). Selain itu resolve matriks.
 */
async function resolveTicketCharge(
  client: PoolClient,
  ctx: TicketingContext,
  vb: ActiveVisitBand & { channel_id: string },
  visitDate: string
): Promise<TicketCharge> {
  if (vb.allocated_price !== null) {
    return {
      ok: true,
      amount: Number(vb.allocated_price),
      description:
        `Tiket ${vb.member_label ?? vb.ticket_type_name} ` + `(alokasi paket, ${visitDate})`,
      priceContext: {
        ticket_product_id: vb.ticket_product_id,
        variant_id: vb.variant_id,
        bundle_product_id: vb.bundle_product_id,
        allocated: true,
        channel_id: vb.channel_id,
        visit_date: visitDate,
      },
    };
  }
  const resolved = await resolveVariantPriceOnDate(client, {
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    variantId: vb.variant_id,
    channelId: vb.channel_id,
    visitDate,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      reason:
        resolved.reason === "tanggal-diblok"
          ? "Tanggal ini diblok untuk kanal kunjungan — hubungi supervisor"
          : `Harga ${vb.ticket_type_name} belum diisi — lengkapi di Master Ticket`,
    };
  }
  return {
    ok: true,
    amount: resolved.price,
    description: `Tiket ${vb.ticket_type_name} (${resolved.seasonKind}, ${visitDate})`,
    priceContext: {
      ticket_product_id: vb.ticket_product_id,
      variant_id: vb.variant_id,
      season_kind: resolved.seasonKind,
      channel_id: vb.channel_id,
      visit_date: visitDate,
    },
  };
}

export async function processGateTap(
  ctx: TicketingContext,
  uid: string,
  gateLabel: string
): Promise<GateTapOutcome> {
  return withTransaction(async (client) => {
    const log = (bandId: string | null, visitId: string | null, result: GateTapResult) =>
      client.query(
        `INSERT INTO ticketing.ticket_gate_events
           (company_id, branch_id, band_uid, band_id, visit_id, gate_label,
            result, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [ctx.companyId, ctx.branchId, uid, bandId, visitId, gateLabel, result, ctx.user.id]
      );
    const markEntered = (visitBandId: string) =>
      client.query(
        `UPDATE ticketing.ticket_visit_bands
         SET entered_at = now(), updated_at = now() WHERE id = $1`,
        [visitBandId]
      );

    const bandResult = await client.query<{ id: string; label: string | null }>(
      `SELECT id, label FROM ticketing.ticket_bands
       WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = $3`,
      [ctx.branchId, ctx.companyId, uid]
    );
    const band = bandResult.rows[0];
    if (!band) {
      await log(null, null, "ditolak-gelang-tak-dikenal");
      return {
        result: "ditolak-gelang-tak-dikenal",
        ok: false,
        reason: "Gelang tidak terdaftar di registry venue",
      };
    }

    // Gelang karyawan (staff pass Fase E) → free access, tanpa charge,
    // bebas keluar-masuk; karyawan nonaktif (resign) ditolak walau
    // pairing lupa dicabut
    const staffResult = await client.query<{ full_name: string; employee_active: boolean }>(
      `SELECT e.full_name, e.is_active AS employee_active
       FROM ticketing.ticket_staff_passes sp
       JOIN hris.employees e ON e.id = sp.employee_id
       WHERE sp.band_id = $1 AND sp.branch_id = $2 AND sp.company_id = $3
         AND sp.is_active = true
       LIMIT 1`,
      [band.id, ctx.branchId, ctx.companyId]
    );
    const staffPass = staffResult.rows[0];
    if (staffPass) {
      const staff = {
        contact_name: staffPass.full_name,
        ticket_type_name: "Akses Karyawan",
        band_label: band.label,
      };
      if (staffPass.employee_active) {
        await log(band.id, null, "masuk-karyawan");
        return { result: "masuk-karyawan", ok: true, ...staff, charged_amount: 0 };
      }
      await log(band.id, null, "ditolak-karyawan-nonaktif");
      return {
        result: "ditolak-karyawan-nonaktif",
        ok: false,
        reason: "Karyawan sudah nonaktif — cabut pairing gelang di Pengaturan Tiket",
        ...staff,
      };
    }

    // Visit aktif utk gelang ini + kunci visit (serialisasi dgn settle/F&B)
    const vbResult = await client.query<ActiveVisitBand>(
      `SELECT vb.id AS visit_band_id, vb.visit_id, vb.variant_id,
              vb.guest_name,
              tp.id AS ticket_product_id,
              tp.name || ' — ' || pv.name AS ticket_type_name,
              tp.re_entry_policy, vb.entered_at,
              v.contact_name, v.payment_mode, v.credit_limit, v.channel_id,
              v.status AS visit_status,
              vb.allocated_price, vb.member_label, vb.bundle_product_id
       FROM ticketing.ticket_visit_bands vb
       JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
       JOIN ticketing.ticket_product_variants pv ON pv.id = vb.variant_id
       JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
       WHERE vb.band_id = $1 AND vb.status = 'aktif'
       ORDER BY vb.created_at DESC
       LIMIT 1
       FOR UPDATE OF vb, v`,
      [band.id]
    );
    const vb = vbResult.rows[0];
    if (!vb || vb.visit_status !== "open") {
      await log(band.id, vb?.visit_id ?? null, "ditolak-tanpa-kunjungan");
      return {
        result: "ditolak-tanpa-kunjungan",
        ok: false,
        reason: "Gelang tidak terikat kunjungan terbuka — daftar di loket dulu",
        band_label: band.label,
      };
    }

    const who = { contact_name: vb.contact_name, ticket_type_name: vb.ticket_type_name };
    const guest = { ...who, guest_name: vb.guest_name, band_label: band.label };

    // Tap ulang → kebijakan re-entry TICKET ybs (revisi owner: per produk)
    if (vb.entered_at !== null) {
      if ((vb.re_entry_policy || "sekali-masuk") === "bebas-keluar-masuk") {
        await log(band.id, vb.visit_id, "masuk-lagi");
        return { result: "masuk-lagi", ok: true, ...guest };
      }
      await log(band.id, vb.visit_id, "ditolak-sudah-masuk");
      return {
        result: "ditolak-sudah-masuk",
        ok: false,
        reason: "Tiket sudah dipakai masuk (kebijakan sekali masuk)",
        ...guest,
      };
    }

    // Visit hasil redeem booking website (D4): tiket sudah di-charge
    // snapshot harga booking saat redeem — tap pertama HANYA menandai
    // masuk, tanpa resolve harga (master berubah ≠ tagihan berubah).
    const bookingVisit = await client.query(
      `SELECT id FROM ticketing.ticket_bookings
       WHERE visit_id = $1 AND branch_id = $2 AND company_id = $3
       LIMIT 1`,
      [vb.visit_id, ctx.branchId, ctx.companyId]
    );
    if (bookingVisit.rows.length > 0) {
      await markEntered(vb.visit_band_id);
      await log(band.id, vb.visit_id, "masuk");
      return { result: "masuk", ok: true, ...guest, charged_amount: 0 };
    }

    // Tap pertama → charge tiket dengan harga hasil resolve matriks
    if (!vb.channel_id) {
      await log(band.id, vb.visit_id, "ditolak-tanpa-kanal");
      return {
        result: "ditolak-tanpa-kanal",
        ok: false,
        reason: "Kunjungan tanpa kanal penjualan — hubungi supervisor",
        ...who,
      };
    }
    const visitDate = todayInJakarta();
    const charge = await resolveTicketCharge(
      client,
      ctx,
      { ...vb, channel_id: vb.channel_id },
      visitDate
    );
    if (!charge.ok) {
      await log(band.id, vb.visit_id, "ditolak-harga-belum-diisi");
      return { result: "ditolak-harga-belum-diisi", ok: false, reason: charge.reason, ...who };
    }

    // Harga 0 = tiket gratis/comp yang sah — masuk tanpa baris ledger
    if (charge.amount === 0) {
      await markEntered(vb.visit_band_id);
      await log(band.id, vb.visit_id, "masuk");
      return { result: "masuk", ok: true, ...who, band_label: band.label, charged_amount: 0 };
    }

    const chargesResult = await client.query<{ direction: "debit" | "kredit"; amount: string }>(
      `SELECT direction, amount FROM ticketing.ticket_visit_charges
       WHERE visit_id = $1`,
      [vb.visit_id]
    );
    const guard = canCharge({
      paymentMode: vb.payment_mode,
      summary: computeTabSummary(
        chargesResult.rows.map((c) => ({ direction: c.direction, amount: Number(c.amount) }))
      ),
      amount: charge.amount,
      creditLimit: vb.credit_limit === null ? null : Number(vb.credit_limit),
    });
    if (!guard.ok) {
      const result = vb.payment_mode === "prepaid" ? "ditolak-saldo-kurang" : "ditolak-plafon";
      await log(band.id, vb.visit_id, result);
      return { result, ok: false, reason: guard.reason, ...who };
    }

    await client.query(
      `INSERT INTO ticketing.ticket_visit_charges
         (company_id, branch_id, visit_id, band_id, charge_type, direction,
          description, amount, price_context, created_by)
       VALUES ($1, $2, $3, $4, 'tiket', 'debit', $5, $6, $7, $8)`,
      [
        ctx.companyId,
        ctx.branchId,
        vb.visit_id,
        band.id,
        charge.description,
        charge.amount,
        JSON.stringify(charge.priceContext),
        ctx.user.id,
      ]
    );
    await markEntered(vb.visit_band_id);
    await log(band.id, vb.visit_id, "masuk");
    return { result: "masuk", ok: true, ...guest, charged_amount: charge.amount };
  });
}
