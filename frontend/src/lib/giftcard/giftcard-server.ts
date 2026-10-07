import "server-only";
// EPIC-034 Fase B+C — jalur uang gift card di sisi server.
//
// Fase B: penerbitan kartu saat penjualan di kasir lunas.
// Fase C: debit saldo untuk membayar order (1 transaksi 1 metode, full-cover)
//         + pengembalian saldo saat langkah checkout berikutnya gagal.
//
// Semua mutasi saldo BER-LOCK (SELECT ... FOR UPDATE) di dalam satu transaksi
// bersama baris ledger-nya — pola tab ticketing (tab-server.ts) dan debit
// atomik ARK Coin. Logika keputusannya sendiri murni & ber-test di
// `giftcard.ts`; modul ini hanya menegakkannya di atas DB.

import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings/app-settings";
import {
  computeBalanceAfterCorrection,
  evaluateGiftCardRedeem,
  evaluateGiftCardReload,
  GIFT_CARD_RELOAD_REJECT_MESSAGES,
  generateGiftCardCode,
  GIFT_CARD_REJECT_MESSAGES,
  isAllowedGiftCardNominal,
  parseGiftCardConfig,
  phoneMatchKey,
  phoneMatchKeySql,
  resolveGiftCardExpiry,
  resolveStatusAfterRefund,
  type GiftCardConfig,
  type GiftCardStatus,
} from "./giftcard";
import {
  GIFT_CARD_RELOAD_PAYMENT_METHODS,
  type GiftCardReloadPaymentMethod,
} from "./reload-payment-methods";

export const GIFT_CARD_CONFIG_KEY = "giftcard_config";

export interface GiftCardScope {
  companyId: string;
  branchId: string;
}

// ── Konfigurasi (nominal preset & masa berlaku) ────────────────────────

export async function loadGiftCardConfig(): Promise<GiftCardConfig> {
  const raw = await getSetting(GIFT_CARD_CONFIG_KEY);
  try {
    return parseGiftCardConfig(raw ? JSON.parse(String(raw)) : null);
  } catch {
    // Nilai rusak di app_settings tidak boleh mematikan kasir
    return parseGiftCardConfig(null);
  }
}

export async function saveGiftCardConfig(
  next: Partial<GiftCardConfig>
): Promise<GiftCardConfig> {
  const merged = parseGiftCardConfig({ ...(await loadGiftCardConfig()), ...next });
  await setSetting(GIFT_CARD_CONFIG_KEY, JSON.stringify(merged));
  return merged;
}

// ── Fase B — kenali baris penjualan gift card di keranjang ─────────────

/** Bentuk longgar — baris keranjang kasir datang sbg number ATAU string. */
export interface GiftCardSaleLineInput {
  product_id?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  variant_price_adjustment?: number | string | null;
  modifier_price_adjustment?: number | string | null;
}

/** Plafon server: satu transaksi kasir tidak menerbitkan lebih dari ini. */
export const MAX_CARDS_PER_ORDER = 20;

export type GiftCardSalePlan =
  | { ok: true; nominals: number[] }
  | { ok: false; reason: string };

/**
 * Tentukan kartu apa saja yang harus terbit dari isi keranjang.
 *
 * Nominal gift card diketik kasir, jadi TIDAK boleh dipercaya mentah: server
 * memuat ulang `product_kind` dari katalog dan memvalidasi setiap nominal ke
 * konfigurasi (preset vs bebas, rupiah bulat, plafon). Keranjang tanpa produk
 * gift card menghasilkan rencana kosong (jalur normal, tanpa biaya query
 * tambahan selain satu SELECT).
 */
export async function prepareGiftCardSale(
  items: GiftCardSaleLineInput[]
): Promise<GiftCardSalePlan> {
  const productIds = [
    ...new Set(
      items.map((item) => String(item.product_id ?? "")).filter(Boolean)
    ),
  ];
  if (productIds.length === 0) return { ok: true, nominals: [] };

  const rows = await query<{ id: string }>(
    `SELECT id FROM pos.pos_products
      WHERE id = ANY($1::uuid[]) AND product_kind = 'gift_card'`,
    [productIds]
  );
  if (rows.length === 0) return { ok: true, nominals: [] };

  const giftCardProductIds = new Set(rows.map((row) => row.id));
  const config = await loadGiftCardConfig();
  const nominals: number[] = [];

  for (const item of items) {
    const productId = String(item.product_id ?? "");
    if (!giftCardProductIds.has(productId)) continue;

    const nominal =
      (Number(item.unit_price) || 0) +
      (Number(item.variant_price_adjustment) || 0) +
      (Number(item.modifier_price_adjustment) || 0);
    if (!isAllowedGiftCardNominal(config, nominal)) {
      return {
        ok: false,
        reason: config.allow_custom
          ? "Nominal gift card tidak valid — isi rupiah bulat di atas 0"
          : `Nominal gift card harus salah satu dari: ${config.presets
              .map((p) => `Rp${p.toLocaleString("id-ID")}`)
              .join(", ")}`,
      };
    }
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    for (let i = 0; i < qty; i++) nominals.push(nominal);

    // Plafon DI SERVER — batas di dialog kasir bisa dilewati dgn memanggil
    // API langsung, dan tiap kartu = satu INSERT + satu baris ledger dalam
    // satu transaksi (qty raksasa = transaksi panjang + pesan WA raksasa).
    if (nominals.length > MAX_CARDS_PER_ORDER) {
      return {
        ok: false,
        reason: `Maksimal ${MAX_CARDS_PER_ORDER} gift card per transaksi`,
      };
    }
  }
  return { ok: true, nominals };
}

// ── Fase B — terbit kartu dari penjualan kasir ─────────────────────────

export interface IssuedGiftCard {
  id: string;
  code: string;
  initial_value: number;
  expires_at: string | null;
}

interface IssueForOrderInput {
  scope: GiftCardScope;
  orderId: string;
  /** Satu entri = satu kartu (qty 3 → 3 entri nominal sama). */
  nominals: number[];
  buyerName: string | null;
  buyerPhone: string | null;
  createdBy: string | null;
}

const MAX_CODE_ROUNDS = 6;

/**
 * Terbitkan kartu untuk order POS yang SUDAH lunas. Idempoten per order:
 * pemanggilan ulang (retry jaringan / order yang sama diproses dua kali)
 * mengembalikan kartu yang sudah ada, tidak menerbitkan kartu baru —
 * kartu = uang, penggandaan tidak boleh terjadi.
 */
export async function issueGiftCardsForPosOrder(
  input: IssueForOrderInput
): Promise<IssuedGiftCard[]> {
  const config = await loadGiftCardConfig();
  const issuedAt = new Date().toISOString();
  const expiresAt = resolveGiftCardExpiry(config.expiry_months, issuedAt);

  return withTransaction(async (client) => {
    const existing = await client.query<{
      id: string;
      code: string;
      initial_value: string;
      expires_at: string | null;
    }>(
      `SELECT id, code, initial_value, expires_at
         FROM giftcard.gift_cards
        WHERE source_type = 'pos_order' AND source_id = $1
        ORDER BY created_at, id`,
      [input.orderId]
    );
    if (existing.rows.length > 0) {
      return existing.rows.map(toIssuedGiftCard);
    }

    const created: IssuedGiftCard[] = [];
    for (const nominal of input.nominals) {
      const card = await insertGiftCardWithUniqueCode(client, {
        scope: input.scope,
        nominal,
        expiresAt,
        sourceType: "pos_order",
        sourceId: input.orderId,
        buyerName: input.buyerName,
        buyerPhone: input.buyerPhone,
        createdBy: input.createdBy,
      });
      created.push(card);
    }
    return created;
  });
}

async function insertGiftCardWithUniqueCode(
  client: PoolClient,
  input: {
    scope: GiftCardScope;
    nominal: number;
    expiresAt: string | null;
    sourceType: "pos_order" | "xendit_invoice";
    sourceId: string;
    buyerName: string | null;
    buyerPhone: string | null;
    createdBy: string | null;
  }
): Promise<IssuedGiftCard> {
  for (let round = 0; round < MAX_CODE_ROUNDS; round++) {
    const inserted = await client.query<{
      id: string;
      code: string;
      initial_value: string;
      expires_at: string | null;
    }>(
      `INSERT INTO giftcard.gift_cards
         (company_id, branch_id, code, initial_value, balance, status,
          expires_at, source_type, source_id, buyer_name, buyer_phone,
          note, created_by, created_at)
       VALUES ($1, $2, $3, $4, $4, 'active', $5, $6, $7, $8, $9, $10, $11, clock_timestamp())
       ON CONFLICT (branch_id, code) DO NOTHING
       RETURNING id, code, initial_value, expires_at`,
      [
        input.scope.companyId,
        input.scope.branchId,
        generateGiftCardCode(),
        input.nominal,
        input.expiresAt,
        input.sourceType,
        input.sourceId,
        input.buyerName,
        input.buyerPhone,
        `Dijual di kasir (order ${input.sourceId})`,
        input.createdBy,
      ]
    );
    const row = inserted.rows[0];
    if (!row) continue; // tabrakan kode — ulang dgn kode baru

    await client.query(
      `INSERT INTO giftcard.gift_card_ledger
         (company_id, branch_id, card_id, direction, amount, balance_after,
          context_type, context_id, note, created_by)
       VALUES ($1, $2, $3, 'isi', $4, $4, 'pos_order', $5, $6, $7)`,
      [
        input.scope.companyId,
        input.scope.branchId,
        row.id,
        input.nominal,
        input.sourceId,
        "Penjualan gift card di kasir",
        input.createdBy,
      ]
    );
    return toIssuedGiftCard(row);
  }
  throw new Error("Gagal menerbitkan kode gift card unik — coba lagi");
}

function toIssuedGiftCard(row: {
  id: string;
  code: string;
  initial_value: string;
  expires_at: string | null;
}): IssuedGiftCard {
  return {
    id: row.id,
    code: row.code,
    initial_value: Number(row.initial_value),
    expires_at: row.expires_at,
  };
}

// ── Fase C — bayar pakai gift card ─────────────────────────────────────

export type GiftCardRedeemOutcome =
  | {
      ok: true;
      cardId: string;
      code: string;
      balanceAfter: number;
      statusAfter: GiftCardStatus;
    }
  | { ok: false; reason: string; status: 400 | 404 | 409 };

interface CardRow {
  id: string;
  code: string;
  balance: string;
  status: GiftCardStatus;
  expires_at: string | null;
}

/**
 * Order keburu didebit permintaan lain (unique index satu-debit-per-order).
 * Dilempar dari DALAM transaksi supaya debitnya ikut di-ROLLBACK, lalu
 * diterjemahkan jadi penolakan 409 di luar.
 */
class GiftCardOrderAlreadyPaidError extends Error {
  constructor() {
    super("Order ini sudah dibayar dengan gift card");
    this.name = "GiftCardOrderAlreadyPaidError";
  }
}

const CARD_LOOKUP_SQL = `
  SELECT id, code, balance, status, expires_at
    FROM giftcard.gift_cards
   WHERE branch_id = $1 AND company_id = $2 AND code = $3`;

/**
 * Debit saldo untuk membayar order POS. Full-cover: `amount` WAJIB total
 * order (keputusan owner "1 transaksi 1 metode"); saldo kurang → ditolak,
 * kasir minta metode lain.
 *
 * Kartu dikunci FOR UPDATE sehingga dua kasir yang memakai kartu sama
 * bersamaan tidak bisa membuat saldo minus. Idempoten per order: order yang
 * sudah pernah didebit ditolak, bukan didebit dua kali.
 */
export async function redeemGiftCardForPosOrder(input: {
  scope: GiftCardScope;
  code: string;
  amount: number;
  orderId: string;
  createdBy: string | null;
}): Promise<GiftCardRedeemOutcome> {
  const code = input.code.trim().toUpperCase();
  const amount = Math.round(input.amount * 100) / 100;

  try {
    return await redeemInTransaction(input, code, amount);
  } catch (err) {
    if (err instanceof GiftCardOrderAlreadyPaidError) {
      return { ok: false, reason: err.message, status: 409 };
    }
    throw err;
  }
}

function redeemInTransaction(
  input: {
    scope: GiftCardScope;
    code: string;
    amount: number;
    orderId: string;
    createdBy: string | null;
  },
  code: string,
  amount: number
): Promise<GiftCardRedeemOutcome> {
  return withTransaction(async (client) => {
    const found = await client.query<CardRow>(`${CARD_LOOKUP_SQL} FOR UPDATE`, [
      input.scope.branchId,
      input.scope.companyId,
      code,
    ]);
    const card = found.rows[0];
    if (!card) {
      return { ok: false as const, reason: "Gift card tidak ditemukan", status: 404 as const };
    }

    // Cek cepat utk pesan yang ramah. Ini SAJA tidak cukup: dua permintaan
    // bersamaan memakai KARTU BERBEDA mengunci baris berbeda, jadi keduanya
    // bisa lolos cek ini. Invarian sebenarnya ditegakkan unique index
    // `gift_card_ledger_one_debit_per_pos_order` — lihat penanganan 23505
    // saat INSERT di bawah.
    const already = await client.query(
      `SELECT 1 FROM giftcard.gift_card_ledger
        WHERE context_type = 'pos_order' AND context_id = $1 AND direction = 'pakai'
        LIMIT 1`,
      [input.orderId]
    );
    if (already.rows.length > 0) {
      return {
        ok: false as const,
        reason: "Order ini sudah dibayar dengan gift card",
        status: 409 as const,
      };
    }

    const evaluation = evaluateGiftCardRedeem(
      {
        status: card.status,
        balance: Number(card.balance),
        expiresAt: card.expires_at,
      },
      amount,
      new Date().toISOString()
    );
    if (!evaluation.ok) {
      return {
        ok: false as const,
        reason: GIFT_CARD_REJECT_MESSAGES[evaluation.reason],
        status: 400 as const,
      };
    }

    await client.query(
      `UPDATE giftcard.gift_cards
          SET balance = $2, status = $3, updated_at = now()
        WHERE id = $1`,
      [card.id, evaluation.balanceAfter, evaluation.statusAfter]
    );
    try {
      await client.query(
        `INSERT INTO giftcard.gift_card_ledger
           (company_id, branch_id, card_id, direction, amount, balance_after,
            context_type, context_id, note, created_by)
         VALUES ($1, $2, $3, 'pakai', $4, $5, 'pos_order', $6, $7, $8)`,
        [
          input.scope.companyId,
          input.scope.branchId,
          card.id,
          amount,
          evaluation.balanceAfter,
          input.orderId,
          "Pembayaran order kasir",
          input.createdBy,
        ]
      );
    } catch (err) {
      // 23505 = order ini keburu didebit permintaan lain (kartu berbeda,
      // lock berbeda). Transaksi ini di-ROLLBACK oleh withTransaction
      // sehingga saldo kartu kedua utuh — bukan error, tapi penolakan.
      if ((err as { code?: string }).code === "23505") {
        throw new GiftCardOrderAlreadyPaidError();
      }
      throw err;
    }

    return {
      ok: true as const,
      cardId: card.id,
      code: card.code,
      balanceAfter: evaluation.balanceAfter,
      statusAfter: evaluation.statusAfter,
    };
  });
}

/**
 * Kembalikan saldo yang sudah terpotong untuk sebuah order — dipakai saat
 * langkah checkout sesudah debit gagal, dan saat void order lunas
 * (otorisasi supervisor).
 *
 * Idempoten: order yang sudah pernah dikembalikan tidak dikembalikan lagi.
 * Best-effort — pemanggil tidak boleh gagal hanya karena refund gagal, tapi
 * WAJIB mencatat lognya (uang tamu).
 */
export async function refundGiftCardForPosOrder(input: {
  scope: GiftCardScope;
  orderId: string;
  createdBy: string | null;
  note?: string;
}): Promise<boolean> {
  return withTransaction(async (client) => {
    const debit = await client.query<{ card_id: string; amount: string }>(
      `SELECT card_id, amount FROM giftcard.gift_card_ledger
        WHERE context_type = 'pos_order' AND context_id = $1 AND direction = 'pakai'
        ORDER BY created_at
        LIMIT 1`,
      [input.orderId]
    );
    const row = debit.rows[0];
    if (!row) return false;

    const reversed = await client.query(
      `SELECT 1 FROM giftcard.gift_card_ledger
        WHERE context_type = 'pos_order' AND context_id = $1 AND direction = 'koreksi'
        LIMIT 1`,
      [input.orderId]
    );
    if (reversed.rows.length > 0) return true;

    const locked = await client.query<CardRow>(
      `SELECT id, code, balance, status, expires_at
         FROM giftcard.gift_cards WHERE id = $1 FOR UPDATE`,
      [row.card_id]
    );
    const card = locked.rows[0];
    if (!card) return false;

    const amount = Number(row.amount);
    const balanceAfter = computeBalanceAfterCorrection(Number(card.balance), amount);
    const statusAfter = resolveStatusAfterRefund(card.status, balanceAfter);

    await client.query(
      `UPDATE giftcard.gift_cards
          SET balance = $2, status = $3, updated_at = now()
        WHERE id = $1`,
      [card.id, balanceAfter, statusAfter]
    );
    await client.query(
      `INSERT INTO giftcard.gift_card_ledger
         (company_id, branch_id, card_id, direction, amount, balance_after,
          context_type, context_id, note, created_by)
       VALUES ($1, $2, $3, 'koreksi', $4, $5, 'pos_order', $6, $7, $8)`,
      [
        input.scope.companyId,
        input.scope.branchId,
        card.id,
        amount, // positif = saldo dikembalikan
        balanceAfter,
        input.orderId,
        input.note ?? "Pengembalian saldo — pembayaran order gagal diselesaikan",
        input.createdBy,
      ]
    );
    return true;
  });
}

export class IssuedGiftCardAlreadyUsedError extends Error {
  constructor(code: string) {
    super(`Gift card ${code} sudah terpakai — void ditolak`);
    this.name = "IssuedGiftCardAlreadyUsedError";
  }
}

/**
 * Matikan kartu yang dijual lewat order ini. Kartu yang sudah ada ledger
 * `pakai` ditolak — tamu sudah belanja saldo titipan itu.
 * Idempoten: kartu `disabled` dilewati.
 */
export async function voidIssuedGiftCardsForPosOrder(input: {
  orderId: string;
  note?: string;
}): Promise<number> {
  return withTransaction(async (client) => {
    const cards = await client.query<{
      id: string;
      code: string;
      status: GiftCardStatus;
    }>(
      `SELECT id, code, status
         FROM giftcard.gift_cards
        WHERE source_type = 'pos_order' AND source_id = $1
        ORDER BY created_at, id
        FOR UPDATE`,
      [input.orderId]
    );
    if (cards.rows.length === 0) return 0;

    let disabled = 0;
    for (const card of cards.rows) {
      const used = await client.query(
        `SELECT 1 FROM giftcard.gift_card_ledger
          WHERE card_id = $1 AND direction = 'pakai'
          LIMIT 1`,
        [card.id]
      );
      if (used.rows.length > 0) {
        throw new IssuedGiftCardAlreadyUsedError(card.code);
      }
      if (card.status === "disabled") {
        disabled += 1;
        continue;
      }
      await client.query(
        `UPDATE giftcard.gift_cards
            SET status = 'disabled',
                note = COALESCE(note, '') || $2,
                updated_at = now()
          WHERE id = $1`,
        [card.id, input.note ?? " — void penjualan kasir"]
      );
      disabled += 1;
    }
    return disabled;
  });
}

// ── Koreksi manual admin (ber-audit) ───────────────────────────────────

export type GiftCardAdjustOutcome =
  | { ok: true; balanceAfter: number; statusAfter: GiftCardStatus }
  | { ok: false; reason: string; status: 400 | 404 };

/**
 * Koreksi saldo oleh admin — untuk salah input di luar void order
 * (void lunas mengembalikan saldo otomatis lewat refundGiftCardForPosOrder).
 *
 * `delta` bertanda: positif mengembalikan saldo, negatif menarik saldo.
 * Kartu dikunci FOR UPDATE — koreksi tidak bisa balapan dengan debit kasir.
 */
export async function adjustGiftCardBalance(input: {
  scope: GiftCardScope;
  cardId: string;
  delta: number;
  reason: string;
  createdBy: string | null;
}): Promise<GiftCardAdjustOutcome> {
  const delta = Math.round(input.delta * 100) / 100;
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: false, reason: "Nominal koreksi tidak boleh 0", status: 400 };
  }

  return withTransaction(async (client) => {
    const found = await client.query<CardRow & { initial_value: string; reloaded_total: string }>(
      `SELECT id, code, balance, status, expires_at, initial_value, reloaded_total
         FROM giftcard.gift_cards
        WHERE id = $1 AND branch_id = $2 AND company_id = $3
        FOR UPDATE`,
      [input.cardId, input.scope.branchId, input.scope.companyId]
    );
    const card = found.rows[0];
    if (!card) {
      return { ok: false as const, reason: "Gift card tidak ditemukan", status: 404 as const };
    }

    let balanceAfter: number;
    try {
      balanceAfter = computeBalanceAfterCorrection(Number(card.balance), delta);
    } catch {
      return {
        ok: false as const,
        reason: "Koreksi membuat saldo negatif",
        status: 400 as const,
      };
    }
    // Menambah saldo di atas total yang pernah diisi = reload, bukan koreksi
    if (balanceAfter > Number(card.initial_value) + Number(card.reloaded_total)) {
      return {
        ok: false as const,
        reason: "Koreksi tidak boleh melebihi total nilai yang pernah diisi — pakai Reload",
        status: 400 as const,
      };
    }

    const statusAfter = resolveStatusAfterRefund(card.status, balanceAfter);
    await client.query(
      `UPDATE giftcard.gift_cards
          SET balance = $2, status = $3, updated_at = now()
        WHERE id = $1`,
      [card.id, balanceAfter, statusAfter]
    );
    await client.query(
      `INSERT INTO giftcard.gift_card_ledger
         (company_id, branch_id, card_id, direction, amount, balance_after,
          context_type, note, created_by)
       VALUES ($1, $2, $3, 'koreksi', $4, $5, 'manual', $6, $7)`,
      [
        input.scope.companyId,
        input.scope.branchId,
        card.id,
        delta,
        balanceAfter,
        input.reason,
        input.createdBy,
      ]
    );
    return { ok: true as const, balanceAfter, statusAfter };
  });
}

// ── Pratinjau untuk kasir (indikatif) ──────────────────────────────────

export type GiftCardPreview =
  | {
      ok: true;
      code: string;
      balance: number;
      covers: boolean;
      expires_at: string | null;
    }
  | { ok: false; reason: string };

/**
 * Cek kartu sebelum bayar. INDIKATIF — kebenaran final tetap ditegakkan saat
 * debit ber-lock (pola promo-check EPIC-032). Tidak pernah membocorkan kode
 * lain: hanya kode yang diketik persis yang dicari.
 */
export async function previewGiftCardForPos(input: {
  scope: GiftCardScope;
  code: string;
  total: number;
}): Promise<GiftCardPreview> {
  const code = input.code.trim().toUpperCase();
  const rows = await query<CardRow>(CARD_LOOKUP_SQL, [
    input.scope.branchId,
    input.scope.companyId,
    code,
  ]);
  const card = rows[0];
  if (!card) return { ok: false, reason: "Gift card tidak ditemukan" };

  const balance = Number(card.balance);
  // Nominal 0 (keranjang kosong) tetap harus melewati guard status/expiry,
  // jadi dievaluasi dengan 1 rupiah — angka sebenarnya diuji ulang saat debit.
  const evaluation = evaluateGiftCardRedeem(
    { status: card.status, balance, expiresAt: card.expires_at },
    input.total > 0 ? Math.min(input.total, balance || 1) : 1,
    new Date().toISOString()
  );
  if (!evaluation.ok) {
    return { ok: false, reason: GIFT_CARD_REJECT_MESSAGES[evaluation.reason] };
  }
  return {
    ok: true,
    code: card.code,
    balance,
    covers: balance >= input.total,
    expires_at: card.expires_at,
  };
}

// ── Reload (top up) dgn pembayaran tercatat ────────────────────────────

export type GiftCardReloadOutcome =
  | { ok: true; ledgerId: string; balanceAfter: number; statusAfter: GiftCardStatus }
  | { ok: false; reason: string; status: 400 | 404 };

/**
 * Isi ulang saldo kartu. Satu transaksi: kunci kartu FOR UPDATE → evaluasi
 * murni → naikkan balance + reloaded_total → baris ledger `isi` ber-context
 * `reload` yang menyimpan metode & referensi pembayaran. Kartu dicari per
 * id (admin) atau per kode (kasir, hasil scan QR).
 */
export async function reloadGiftCard(input: {
  scope: GiftCardScope;
  card: { id: string } | { code: string };
  amount: number;
  paymentMethod: GiftCardReloadPaymentMethod;
  paymentReference: string | null;
  note: string | null;
  createdBy: string | null;
}): Promise<GiftCardReloadOutcome> {
  return withTransaction(async (client) => {
    const [column, key] =
      "id" in input.card
        ? ["id", input.card.id]
        : ["code", input.card.code.trim().toUpperCase()];
    const found = await client.query<CardRow & { reloaded_total: string }>(
      `SELECT id, code, balance, status, expires_at, reloaded_total
         FROM giftcard.gift_cards
        WHERE ${column} = $1 AND branch_id = $2 AND company_id = $3
        FOR UPDATE`,
      [key, input.scope.branchId, input.scope.companyId]
    );
    const card = found.rows[0];
    if (!card) {
      return { ok: false as const, reason: "Gift card tidak ditemukan", status: 404 as const };
    }

    const evaluation = evaluateGiftCardReload(
      {
        status: card.status,
        balance: Number(card.balance),
        expiresAt: card.expires_at,
        reloadedTotal: Number(card.reloaded_total),
      },
      input.amount,
      new Date().toISOString()
    );
    if (!evaluation.ok) {
      return {
        ok: false as const,
        reason: GIFT_CARD_RELOAD_REJECT_MESSAGES[evaluation.reason],
        status: 400 as const,
      };
    }

    await client.query(
      `UPDATE giftcard.gift_cards
          SET balance = $2, reloaded_total = $3, status = $4, updated_at = now()
        WHERE id = $1`,
      [card.id, evaluation.balanceAfter, evaluation.reloadedTotalAfter, evaluation.statusAfter]
    );
    const ledger = await client.query<{ id: string }>(
      `INSERT INTO giftcard.gift_card_ledger
         (company_id, branch_id, card_id, direction, amount, balance_after,
          context_type, payment_method, payment_reference, note, created_by)
       VALUES ($1, $2, $3, 'isi', $4, $5, 'reload', $6, $7, $8, $9)
       RETURNING id`,
      [
        input.scope.companyId,
        input.scope.branchId,
        card.id,
        input.amount,
        evaluation.balanceAfter,
        input.paymentMethod,
        input.paymentReference,
        input.note ??
          `Reload saldo (${GIFT_CARD_RELOAD_PAYMENT_METHODS[input.paymentMethod]})`,
        input.createdBy,
      ]
    );
    return {
      ok: true as const,
      ledgerId: ledger.rows[0]!.id,
      balanceAfter: evaluation.balanceAfter,
      statusAfter: evaluation.statusAfter,
    };
  });
}

// ── Tautan kartu ↔ member ──────────────────────────────────────────────

export interface GiftCardMemberMatch {
  id: string;
  name: string | null;
  phone: string | null;
}

/**
 * Cari member berdasarkan nomor HP. Nomor dinormalisasi ke digit saja dan
 * awalan 0/62 disamakan, sehingga "0812…", "+62812…", "62812…" cocok.
 */
export async function findMembersByPhone(phone: string): Promise<GiftCardMemberMatch[]> {
  const digits = phoneMatchKey(phone);
  if (digits.length < 6) return [];
  return query<GiftCardMemberMatch & Record<string, unknown>>(
    `SELECT id, name, phone FROM pos.pos_customers
      WHERE ${phoneMatchKeySql("phone")} LIKE $1
      ORDER BY name
      LIMIT 10`,
    [`${digits}%`]
  );
}

/** Tautkan / lepas kartu dari member (customer_id null = lepas). */
export async function linkGiftCardToMember(input: {
  scope: GiftCardScope;
  cardId: string;
  customerId: string | null;
}): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE giftcard.gift_cards
        SET customer_id = $1, updated_at = now()
      WHERE id = $2 AND branch_id = $3 AND company_id = $4
        AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM pos.pos_customers WHERE id = $1::uuid))
      RETURNING id`,
    [input.customerId, input.cardId, input.scope.branchId, input.scope.companyId]
  );
  return rows.length > 0;
}
