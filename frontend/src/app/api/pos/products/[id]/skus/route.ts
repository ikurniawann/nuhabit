// EPIC-039 Fase B — kelola varian SKU merchandise sebuah produk POS.
// GET: daftar SKU produk; POST: buat SKU baru.

import { NextRequest, NextResponse } from 'next/server';
import { getPosSession } from '@/lib/api/auth';
import { IAM } from '@/lib/iam/prefixes';
import { iamActionOrResponse } from '@/lib/pos/route-guards';
import { createPgClient } from '@/lib/pg/create-client';
import { normalizeSkuPayload, isUniqueViolation } from '@/lib/pos/merchandise-sku-payload';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const db = createPgClient();
    const { data, error } = await db
      .from('pos_product_skus')
      .select('*')
      .eq('product_id', id)
      .order('name');

    if (error) throw error;
    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error: unknown) {
    console.error('Error listing product SKUs:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Mengubah data master → izin aksi IAM, bukan sekadar sesi kasir POS.
  const user = await iamActionOrResponse(IAM.posCatalogProducts, "create");
  if (user instanceof Response) return user;

  try {
    const { id } = await params;
    const body = await request.json();
    const normalized = normalizeSkuPayload(body, { requireCore: true });
    if (!normalized.ok) {
      return NextResponse.json({ success: false, error: normalized.error }, { status: 400 });
    }

    const db = createPgClient();

    // SKU hanya untuk produk merchandise — jaga invariant di server
    const { data: product, error: productError } = await db
      .from('pos_products')
      .select('id, product_kind')
      .eq('id', id)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) {
      return NextResponse.json({ success: false, error: 'Produk tidak ditemukan' }, { status: 404 });
    }
    if ((product as { product_kind?: string }).product_kind !== 'merchandise') {
      return NextResponse.json(
        { success: false, error: 'Varian SKU hanya untuk produk merchandise' },
        { status: 400 }
      );
    }

    const { data, error } = await db
      .from('pos_product_skus')
      .insert({ ...normalized.columns, product_id: id })
      .select('*')
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        return NextResponse.json(
          { success: false, error: 'Kode SKU / barcode sudah dipakai varian lain' },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error: unknown) {
    console.error('Error creating product SKU:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
