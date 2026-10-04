// EPIC-034 Fase A — gift card dari tab Promo: daftar, terbit (kode CSPRNG,
// langsung `active`), riwayat ledger, dan toggle aktif/nonaktif. Logika saldo
// (reload, koreksi, tautan member) tetap di @/lib/giftcard/giftcard-server.
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { generateGiftCardCode, phoneMatchKey, phoneMatchKeySql } from "@/lib/giftcard/giftcard";
import { fillUniqueCodes } from "./campaign-rules";
import type { PromoContext, PromoVenue } from "./server";

export interface GiftCardRow {
  id: string;
  code: string;
  initial_value: string;
  balance: string;
  status: string;
  expires_at: string | null;
  source_type: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  note: string | null;
  created_at: string;
  reloaded_total: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
}

export interface GiftCardLedgerRow {
  id: string;
  direction: string;
  amount: string;
  balance_after: string;
  context_type: string | null;
  context_id: string | null;
  note: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  created_at: string;
}

const MAX_BATCH = 500;

export const giftCardIssueSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("single"),
    initial_value: z.number().positive().max(100_000_000),
    expires_at: z.string().trim().min(1).nullable().optional(),
    buyer_name: z.string().trim().max(120).nullable().optional(),
    buyer_phone: z.string().trim().max(25).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    customer_id: z.string().uuid().nullable().optional(),
  }),
  z.object({
    mode: z.literal("batch"),
    initial_value: z.number().positive().max(100_000_000),
    count: z.number().int().min(1).max(MAX_BATCH),
    expires_at: z.string().trim().min(1).nullable().optional(),
  }),
]);
export type GiftCardIssueInput = z.infer<typeof giftCardIssueSchema>;

export interface GiftCardFilters {
  status: string | null;
  q: string | null;
  /** Kartu milik satu member (dipakai detail member CRM). */
  customerId: string | null;
  phone: string;
}

export async function listGiftCards(venue: PromoVenue, f: GiftCardFilters): Promise<GiftCardRow[]> {
  const conditions = ["g.branch_id = $1", "g.company_id = $2"];
  const params: unknown[] = [venue.branchId, venue.companyId];
  if (f.status) {
    params.push(f.status);
    conditions.push(`g.status = $${params.length}`);
  }
  const q = f.q?.trim();
  if (q) {
    params.push(`%${q.toUpperCase()}%`);
    conditions.push(`g.code LIKE $${params.length}`);
  }
  if (f.customerId) {
    if (!z.string().uuid().safeParse(f.customerId).success) throw ApiError.badRequest("customer_id tidak valid");
    params.push(f.customerId);
    conditions.push(`g.customer_id = $${params.length}`);
  }
  const phoneDigits = phoneMatchKey(f.phone);
  if (phoneDigits.length >= 6) {
    params.push(`${phoneDigits}%`);
    conditions.push(
      `(${phoneMatchKeySql("c.phone")} LIKE $${params.length} OR ${phoneMatchKeySql("g.buyer_phone")} LIKE $${params.length})`
    );
  }
  return query<GiftCardRow>(
    `SELECT g.id, g.code, g.initial_value, g.balance, g.status, g.expires_at,
            g.source_type, g.buyer_name, g.buyer_phone, g.note, g.created_at,
            g.reloaded_total, g.customer_id,
            c.name AS customer_name, c.phone AS customer_phone
     FROM giftcard.gift_cards g
     LEFT JOIN pos.pos_customers c ON c.id = g.customer_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY g.created_at DESC
     LIMIT 500`,
    params
  );
}

/** Terbitkan 1 kartu (single) atau batch; tiap kartu dapat baris ledger `isi` saldo awal. */
export async function issueGiftCards(ctx: PromoContext, body: GiftCardIssueInput) {
  const single = body.mode === "single" ? body : null;
  const count = body.mode === "single" ? 1 : body.count;
  return withTransaction(async (client) => {
    const cards = await fillUniqueCodes({
      need: count,
      generate: generateGiftCardCode,
      insert: async (candidates) => {
        const inserted = await client.query<{ id: string; code: string }>(
          `INSERT INTO giftcard.gift_cards
             (company_id, branch_id, code, initial_value, balance, status,
              expires_at, source_type, buyer_name, buyer_phone, note, created_by,
              customer_id)
           SELECT $1, $2, unnest($3::text[]), $4, $4, 'active',
                  $5, 'manual', $6, $7, $8, $9, $10
           ON CONFLICT (branch_id, code) DO NOTHING
           RETURNING id, code`,
          [
            ctx.companyId,
            ctx.branchId,
            candidates,
            body.initial_value,
            body.expires_at ?? null,
            single?.buyer_name ?? null,
            single?.buyer_phone ?? null,
            single?.note ?? null,
            ctx.user.id,
            single?.customer_id ?? null,
          ]
        );
        return inserted.rows;
      },
      shortMessage: (made, need) => `Hanya ${made}/${need} gift card berhasil dibuat — coba lagi`,
    });
    // Ledger 'isi' — saldo awal setiap kartu = initial_value (kartu baru)
    await client.query(
      `INSERT INTO giftcard.gift_card_ledger
         (company_id, branch_id, card_id, direction, amount, balance_after,
          context_type, created_by)
       SELECT $1, $2, unnest($3::uuid[]), 'isi', $4, $4, 'manual', $5`,
      [ctx.companyId, ctx.branchId, cards.map((c) => c.id), body.initial_value, ctx.user.id]
    );
    return cards;
  });
}

/** Riwayat pergerakan saldo satu kartu (isi/pakai/koreksi), 500 terbaru. */
export async function loadGiftCardLedger(venue: PromoVenue, id: string): Promise<GiftCardLedgerRow[]> {
  const card = await queryOne<{ id: string }>(
    `SELECT id FROM giftcard.gift_cards
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, venue.branchId, venue.companyId]
  );
  if (!card) throw ApiError.notFound("Gift card tidak ditemukan");
  return query<GiftCardLedgerRow>(
    `SELECT id, direction, amount, balance_after, context_type,
            context_id, note, payment_method, payment_reference, created_at
     FROM giftcard.gift_card_ledger
     WHERE card_id = $1
     ORDER BY created_at DESC
     LIMIT 500`,
    [id]
  );
}

/**
 * Toggle hanya bolak-balik `active` <-> `disabled`; kartu `pending` /
 * `exhausted` / `expired` punya siklus hidup sendiri (409).
 */
export async function setGiftCardActive(venue: PromoVenue, id: string, active: boolean) {
  const current = await queryOne<{ status: string }>(
    `SELECT status FROM giftcard.gift_cards
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, venue.branchId, venue.companyId]
  );
  if (!current) throw ApiError.notFound("Gift card tidak ditemukan");
  if (current.status !== "active" && current.status !== "disabled") {
    throw ApiError.conflict(`Gift card berstatus '${current.status}' tidak bisa diubah lewat aksi ini`);
  }
  return queryOne<{ id: string; status: string }>(
    `UPDATE giftcard.gift_cards
     SET status = $1, updated_at = now()
     WHERE id = $2 AND branch_id = $3 AND company_id = $4
     RETURNING id, status`,
    [active ? "active" : "disabled", id, venue.branchId, venue.companyId]
  );
}
