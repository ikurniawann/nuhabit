import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import {
  generateGiftCardCode,
  phoneMatchKey,
  phoneMatchKeySql,
} from "@/lib/giftcard/giftcard";
import { requirePromoContext } from "@/lib/giftcard/server";

// EPIC-034 Fase A — terbit gift card (admin, langsung `active`; jual di
// kasir/online = Fase B/D). Kode SELALU auto-generate CSPRNG (bearer murni,
// tanpa PIN — keputusan owner), admin tidak mengetik kode sendiri.

interface GiftCardRow {
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

const UUID = z.string().uuid();

const MAX_BATCH = 500;

export async function GET(request: NextRequest) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const q = searchParams.get("q")?.trim();
    // Kartu milik satu member (dipakai detail member CRM) / cari per nomor HP
    const customerId = searchParams.get("customer_id");
    const phoneDigits = phoneMatchKey(searchParams.get("phone") ?? "");

    const conditions = ["g.branch_id = $1", "g.company_id = $2"];
    const params: unknown[] = [ctx.branchId, ctx.companyId];
    if (status) {
      params.push(status);
      conditions.push(`g.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q.toUpperCase()}%`);
      conditions.push(`g.code LIKE $${params.length}`);
    }
    if (customerId) {
      if (!UUID.safeParse(customerId).success) {
        return NextResponse.json(
          { success: false, error: "customer_id tidak valid" },
          { status: 400 }
        );
      }
      params.push(customerId);
      conditions.push(`g.customer_id = $${params.length}`);
    }
    if (phoneDigits.length >= 6) {
      params.push(`${phoneDigits}%`);
      conditions.push(
        `(${phoneMatchKeySql("c.phone")} LIKE $${params.length} OR ${phoneMatchKeySql("g.buyer_phone")} LIKE $${params.length})`
      );
    }

    const rows = await query<GiftCardRow>(
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
    return successResponse(rows);
  } catch (err) {
    console.error("[giftcard] list error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat gift card" },
      { status: 500 }
    );
  }
}

const issueSchema = z.discriminatedUnion("mode", [
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

export async function POST(request: NextRequest) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const parsed = issueSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const expiresAt = body.expires_at ?? null;
    const count = body.mode === "single" ? 1 : body.count;

    // Generate kode unik dgn retry tabrakan (pola batch voucher promo,
    // maks 6 ronde) — kode bearer CSPRNG, tak pernah diketik admin.
    const created: { id: string; code: string }[] = [];
    await withTransaction(async (client) => {
      for (let round = 0; round < 6 && created.length < count; round++) {
        const need = count - created.length;
        const candidates = new Set<string>();
        while (candidates.size < need) candidates.add(generateGiftCardCode());
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
            [...candidates],
            body.initial_value,
            expiresAt,
            body.mode === "single" ? body.buyer_name ?? null : null,
            body.mode === "single" ? body.buyer_phone ?? null : null,
            body.mode === "single" ? body.note ?? null : null,
            ctx.user.id,
            body.mode === "single" ? body.customer_id ?? null : null,
          ]
        );
        created.push(...inserted.rows);
      }
      if (created.length < count) {
        throw new Error(
          `Hanya ${created.length}/${count} gift card berhasil dibuat — coba lagi`
        );
      }
      // Ledger 'isi' — saldo awal setiap kartu = initial_value (kartu baru)
      await client.query(
        `INSERT INTO giftcard.gift_card_ledger
           (company_id, branch_id, card_id, direction, amount, balance_after,
            context_type, created_by)
         SELECT $1, $2, unnest($3::uuid[]), 'isi', $4, $4, 'manual', $5`,
        [
          ctx.companyId,
          ctx.branchId,
          created.map((c) => c.id),
          body.initial_value,
          ctx.user.id,
        ]
      );
    });

    if (body.mode === "single") {
      return successResponse(created[0], "Gift card diterbitkan");
    }
    return successResponse(
      { count: created.length, codes: created.map((c) => c.code) },
      `${created.length} gift card diterbitkan`
    );
  } catch (err) {
    console.error("[giftcard] issue error:", err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || "Gagal menerbitkan gift card" },
      { status: 500 }
    );
  }
}
