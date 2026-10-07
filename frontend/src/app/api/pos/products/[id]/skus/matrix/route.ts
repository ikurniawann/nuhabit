// EPIC-047 Fase 1A — generate/reconcile matriks varian (ukuran x warna x ...)
// jadi baris pos_product_skus dalam satu transaksi. Idempoten: kirim matriks
// yang sama dua kali = no-op. SKU ber-stok tidak pernah hilang diam-diam
// (409 sebelum tulisan apa pun terjadi).

import { NextRequest, NextResponse } from 'next/server';
import { IAM } from '@/lib/iam/prefixes';
import { iamActionOrResponse } from '@/lib/pos/route-guards';
import { createPgClient } from '@/lib/pg/create-client';
import { withTransaction } from '@/lib/db';
import {
  normalizeSkuPayload,
  isUniqueViolation,
  type SkuPayload,
} from '@/lib/pos/merchandise-sku-payload';
import {
  blockedDeactivations,
  buildSkuCode,
  buildSkuName,
  composedBarcodeTooLong,
  diffMatrix,
  expandMatrix,
  MatrixTooLargeError,
  validateMatrixSize,
  type ExistingSku,
  type VariantAxis,
} from '@/lib/pos/merchandise-variants';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** Ditandai lewat instance-check saat validasi baris hasil generate gagal. */
class SkuValidationError extends Error {}

type SkuRow = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  options: Record<string, string> | null;
  barcode: string | null;
  price_override: string | number | null;
  stock_quantity: string | number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type MatrixBody = {
  axes?: VariantAxis[];
  price_override?: number | string | null;
  barcode_prefix?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Mengubah data master → izin aksi IAM, bukan sekadar sesi kasir POS.
  const user = await iamActionOrResponse(IAM.posCatalogProducts, "create");
  if (user instanceof Response) return user;

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as MatrixBody;

    const db = createPgClient();

    // EPIC-047 security fix (S4) — urutan validasi: sesi → params → produk
    // (404) → gerbang merchandise (400) → validasi body (bentuk/ukuran
    // matriks, harga, prefix barcode, barcode gabungan) → transaksi. Cek
    // yang tidak bergantung pada produk pindah SETELAH lookup produk, jadi
    // matriks besar terhadap produk yang tidak ada berhenti di 404, bukan
    // divalidasi ukurannya dulu.
    const { data: product, error: productError } = await db
      .from('pos_products')
      .select('id, sku, name, product_kind')
      .eq('id', id)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) {
      return NextResponse.json({ success: false, error: 'Produk tidak ditemukan' }, { status: 404 });
    }
    const productRow = product as { id: string; sku: string; name: string; product_kind?: string };
    if (productRow.product_kind !== 'merchandise') {
      return NextResponse.json(
        { success: false, error: 'Varian SKU hanya untuk produk merchandise' },
        { status: 400 }
      );
    }

    // EPIC-047 security fix (S1) — validateMatrixSize (aritmetik, tanpa
    // alokasi) berjalan SEBELUM expandMatrix, agar body raksasa (mis. 5
    // sumbu x 40 nilai = 102 juta kombinasi) tidak pernah di-cartesian-kan
    // di memori sebelum ditolak. Juga menangani S3: bentuk axes yang salah
    // (bukan array, values bukan array, dst.) ditolak di sini dengan pesan
    // spesifik, bukan menabrak TypeError yang bocor jadi 500.
    const sizeCheck = validateMatrixSize(body.axes as VariantAxis[]);
    if (!sizeCheck.ok) {
      return NextResponse.json({ success: false, error: sizeCheck.error }, { status: 400 });
    }
    const rawAxes = (body.axes ?? []) as VariantAxis[];
    const wanted = expandMatrix(rawAxes);
    if (wanted.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Sumbu varian (axes) wajib diisi, minimal satu sumbu dengan nilai' },
        { status: 400 }
      );
    }

    // Validasi price_override sekali di awal (sama untuk semua baris) —
    // reuse aturan normalizeSkuPayload.
    let priceOverrideColumn: number | null = null;
    if (body.price_override !== undefined) {
      const normPrice = normalizeSkuPayload({ price_override: body.price_override });
      if (!normPrice.ok) {
        return NextResponse.json({ success: false, error: normPrice.error }, { status: 400 });
      }
      priceOverrideColumn = (normPrice.columns.price_override as number | null) ?? null;
    }
    const barcodePrefix =
      typeof body.barcode_prefix === 'string' ? body.barcode_prefix.trim() : '';
    // EPIC-047 security fix (F2) — cap panjang prefix barcode.
    if (barcodePrefix.length > 20) {
      return NextResponse.json(
        { success: false, error: 'Prefix barcode maksimal 20 karakter' },
        { status: 400 }
      );
    }
    // EPIC-047 security fix (S2) — barcode gabungan (prefix + kode SKU) bisa
    // melebihi 64 karakter walau prefix ≤20 & SKU ≤60 masing-masing lolos.
    // Dicek PRA-transaksi (deterministik, murni) supaya matriks yang valid
    // tidak gagal mendadak di tengah transaksi (setelah FOR UPDATE lock &
    // reactivate UPDATE) — normalizeSkuPayload's 64-char cap tetap ada
    // sebagai defense-in-depth kalau baris ini pernah dilewati.
    if (barcodePrefix) {
      const skuCodes = wanted.map((options) => buildSkuCode(productRow.sku, options));
      if (composedBarcodeTooLong(barcodePrefix, skuCodes)) {
        return NextResponse.json(
          { success: false, error: 'Barcode gabungan melebihi 64 karakter; perpendek prefix' },
          { status: 400 }
        );
      }
    }

    const txResult = await withTransaction(async (client) => {
      // FOR UPDATE: kunci baris SKU produk ini selama diff + tulis, agar dua
      // request matriks yang tumpang tindih tidak balapan.
      const existingRes = await client.query<SkuRow>(
        `SELECT id, product_id, sku, name, options, barcode, price_override,
                stock_quantity, is_active, created_at, updated_at
         FROM pos.pos_product_skus
         WHERE product_id = $1
         FOR UPDATE`,
        [id]
      );
      const existing: (SkuRow & ExistingSku)[] = existingRes.rows.map((row) => ({
        ...row,
        options: row.options ?? {},
        stock_quantity: Number(row.stock_quantity),
      }));

      const diff = diffMatrix(existing, wanted);
      const deactivateIds = diff.deactivate.map((row) => row.id);
      const blocked = blockedDeactivations(existing, deactivateIds);

      // Cek DULU sebelum tulisan apa pun — 409 harus meninggalkan nol
      // perubahan.
      if (blocked.length > 0) {
        return { kind: 'blocked' as const, blocked };
      }

      // F5 fix — varian yang sempat di-drop (is_active=false) tapi diminta
      // lagi di matriks ini dihidupkan kembali, BUKAN di-insert ulang (kode
      // `sku` lama masih unik & akan tabrakan kalau di-INSERT lagi). SKU,
      // nama, barcode, price_override, dan stok baris lama TIDAK ditimpa.
      // Dijalankan sebelum insert `create` supaya urutan tulisan konsisten
      // dengan diffMatrix: reactivate -> create -> deactivate.
      const reactivateIds = diff.reactivate.map((row) => row.id);
      let reactivated: Array<Pick<SkuRow, 'id' | 'sku' | 'name' | 'options'>> = [];
      if (reactivateIds.length > 0) {
        const reactivateRes = await client.query<Pick<SkuRow, 'id' | 'sku' | 'name' | 'options'>>(
          `UPDATE pos.pos_product_skus
           SET is_active = true, updated_at = now()
           WHERE product_id = $1 AND id = ANY($2::uuid[]) AND is_active = false
           RETURNING id, sku, name, options`,
          [id, reactivateIds]
        );
        reactivated = reactivateRes.rows;
      }

      const created: SkuRow[] = [];
      for (const options of diff.create) {
        const sku = buildSkuCode(productRow.sku, options);
        const name = buildSkuName(productRow.name, options);
        const barcode = barcodePrefix ? `${barcodePrefix}${sku}` : null;
        const payload: SkuPayload = {
          sku,
          name,
          options,
          barcode,
          price_override: priceOverrideColumn,
          stock_quantity: 0,
          is_active: true,
        };
        const normalized = normalizeSkuPayload(payload, { requireCore: true });
        if (!normalized.ok) {
          throw new SkuValidationError(normalized.error);
        }
        const cols = normalized.columns as Required<Pick<SkuPayload, 'sku' | 'name'>> &
          Omit<SkuPayload, 'sku' | 'name'>;
        const insertRes = await client.query<SkuRow>(
          `INSERT INTO pos.pos_product_skus
             (product_id, sku, name, options, barcode, price_override, stock_quantity, is_active)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
           RETURNING id, product_id, sku, name, options, barcode, price_override,
                     stock_quantity, is_active, created_at, updated_at`,
          [
            id,
            cols.sku,
            cols.name,
            JSON.stringify(cols.options ?? options),
            cols.barcode ?? null,
            cols.price_override ?? null,
            cols.stock_quantity ?? 0,
            cols.is_active ?? true,
          ]
        );
        created.push(insertRes.rows[0]);
      }

      // EPIC-047 security fix (F3) — satu UPDATE batched & discope ke
      // product_id (defense-in-depth), bukan loop per-id tanpa scoping.
      let deactivated: SkuRow[] = [];
      if (deactivateIds.length > 0) {
        const deactivateRes = await client.query<SkuRow>(
          `UPDATE pos.pos_product_skus
           SET is_active = false, updated_at = now()
           WHERE product_id = $1 AND id = ANY($2::uuid[]) AND is_active = true
           RETURNING id, product_id, sku, name, options, barcode, price_override,
                     stock_quantity, is_active, created_at, updated_at`,
          [id, deactivateIds]
        );
        deactivated = deactivateRes.rows;
      }

      const allRes = await client.query<SkuRow>(
        `SELECT id, product_id, sku, name, options, barcode, price_override,
                stock_quantity, is_active, created_at, updated_at
         FROM pos.pos_product_skus
         WHERE product_id = $1
         ORDER BY name`,
        [id]
      );

      return {
        kind: 'ok' as const,
        created,
        reactivated,
        deactivated,
        kept: diff.keep,
        skus: allRes.rows,
      };
    });

    if (txResult.kind === 'blocked') {
      return NextResponse.json(
        {
          success: false,
          error: 'SKU dengan stok masih ada tidak bisa dinonaktifkan otomatis — kosongkan stoknya dulu',
          blocked: txResult.blocked.map((row) => ({
            id: row.id,
            sku: row.sku,
            name: row.name,
            stock_quantity: row.stock_quantity,
          })),
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        created: txResult.created,
        reactivated: txResult.reactivated,
        deactivated: txResult.deactivated,
        kept: txResult.kept,
        skus: txResult.skus,
      },
    });
  } catch (error: unknown) {
    // EPIC-047 security fix (S1) — defense-in-depth: kalau expandMatrix
    // sendiri pernah dipanggil dengan matriks kebesaran (mis. urutan di
    // atas berubah lagi di masa depan), tangkap self-guard-nya sebagai 400
    // yang sopan, bukan 500. Tidak diharapkan tercapai di jalur normal
    // karena validateMatrixSize sudah menolak lebih dulu.
    if (error instanceof MatrixTooLargeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof SkuValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { success: false, error: 'Kode SKU / barcode sudah dipakai varian lain' },
        { status: 409 }
      );
    }
    console.error('Error generating SKU matrix:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
