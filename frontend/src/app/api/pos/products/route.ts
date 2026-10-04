import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { requirePosMenu } from '@/lib/api/auth';
import { IAM } from '@/lib/iam/prefixes';
import { getApiUserScope } from '@/lib/api/scope';
import { enrichPosProductsWithPurchasingCogs } from '@/lib/pos/purchasing-sync';
import { isSoldIn } from '@/lib/pos/sales-channels';
import {
  buildMerchandiseColumns,
  type MerchandiseFieldsPayload,
} from '@/lib/pos/merchandise-fields';
import {
  loadPosProductStallInfo,
  loadPosProductWarehouses,
} from '@/lib/pos/pos-sell-stall-server';
import {
  applyStallScopeToProductIds,
  resolvePosProductStallScope,
} from '@/lib/pos/stall-product-scope';

type ProductVariantPayload = {
  name?: string;
  group_name?: string;
  price_adjustment?: number | string;
  display_order?: number | string;
};

type ProductModifierPayload = {
  name?: string;
  price_adjustment?: number | string;
  display_order?: number | string;
};

type ProductModifierGroupPayload = {
  name?: string;
  min_selection?: number | string;
  max_selection?: number | string;
  display_order?: number | string;
  modifiers?: ProductModifierPayload[];
};

type ProductCreatePayload = MerchandiseFieldsPayload & {
  sku?: string;
  name?: string;
  description?: string;
  category_id?: string;
  base_price?: number | string;
  cost_price?: number | string;
  xp?: number | string;
  xp_points?: number | string;
  station?: string;
  is_active?: boolean;
  variants?: ProductVariantPayload[];
  modifierGroups?: ProductModifierGroupPayload[];
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function withProductXpAlias<T extends Record<string, unknown>>(product: T) {
  return {
    ...product,
    xp: Number(product.xp_points ?? product.xp ?? 0),
    station: typeof product.station === 'string' ? product.station : 'kitchen',
  };
}

function normalizeStation(value?: string) {
  const station = String(value || '').trim().toLowerCase();
  if (['kitchen', 'bar', 'bakery', 'dessert', 'merchandise', 'photobooth'].includes(station)) {
    return station;
  }
  return 'kitchen';
}

// GET /api/pos/products - List active products scoped to login stall assignment
export async function GET(request: NextRequest) {
  try {
    const pos = await requirePosMenu(IAM.posCatalog);
    if (pos.error) return pos.error;
    const db = createPgClient();
    const scope = await getApiUserScope();
    const stallScope = await resolvePosProductStallScope(scope);
    const allowedIds = applyStallScopeToProductIds(stallScope);

    if (allowedIds && allowedIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        meta: {
          stall_scoped: true,
          warehouse_ids: stallScope.mode === "ids" ? stallScope.warehouseIds : [],
          reason:
            stallScope.mode === "none"
              ? stallScope.reason || "no_stall_assignment"
              : "no_products_for_stall",
          active_mode: stallScope.activeMode,
        },
      });
    }

    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const includeInactive = searchParams.get('include_inactive') === 'true';

    let query = db
      .from('pos_products')
      .select(`
        *,
        category:pos_categories(name),
        variants:pos_product_variants(*),
        skus:pos_product_skus(*),
        channels:product_channels(channel_code, is_distributed),
        modifiers:pos_product_modifiers(
          modifier_group:pos_modifier_groups(
            id,
            name,
            min_selection,
            max_selection,
            display_order,
            modifiers:pos_modifiers(*)
          )
        )
      `)
      .order('name');

    if (allowedIds) {
      query = query.in('id', allowedIds);
    }

    if (!includeInactive) {
      query = query.eq('is_active', true).eq('is_available', true);
    }

    if (category) {
      query = query.eq('category_id', category);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Daftar jual kasir: sembunyikan produk yang tidak dijual di kasir
    // (mis. bundling "hanya GoFood"). Halaman Produk (include_inactive) tetap lihat semua.
    const rows = (data ?? []) as Array<Record<string, unknown> & { sales_channels?: unknown }>;
    const visibleRows = includeInactive ? rows : rows.filter((product) => isSoldIn(product.sales_channels, "pos"));
    const normalizedProducts = visibleRows.map((product) =>
      withProductXpAlias(product as Record<string, unknown>)
    );

    const enrichedProducts = await enrichPosProductsWithPurchasingCogs(
      db,
      normalizedProducts as Array<Record<string, unknown>>
    );

    const productIds = enrichedProducts.map((product) => String(product.id ?? ""));
    const [warehouseByProduct, stallInfo] = await Promise.all([
      loadPosProductWarehouses(productIds),
      loadPosProductStallInfo(productIds),
    ]);
    const productsWithWarehouse = enrichedProducts.map((product) => {
      const id = String(product.id ?? "");
      const warehouse = warehouseByProduct.get(id);
      const info = stallInfo.get(id);
      return {
        ...product,
        warehouse_id: warehouse?.warehouse_id ?? info?.warehouse_id ?? null,
        warehouse_name: warehouse?.warehouse_name ?? info?.stall_name ?? null,
        stall_warehouse_id: info?.warehouse_id ?? warehouse?.warehouse_id ?? null,
        stall_code: info?.stall_code ?? null,
        stall_name: info?.stall_name ?? warehouse?.warehouse_name ?? null,
      };
    });

    return NextResponse.json({
      success: true,
      data: productsWithWarehouse,
      meta: {
        stall_scoped: allowedIds !== null,
        all_stalls: stallScope.mode === "all",
        warehouse_ids: stallScope.mode === "ids" ? stallScope.warehouseIds : [],
        product_count: productsWithWarehouse.length,
        active_mode: stallScope.activeMode,
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// POST /api/pos/products - Create new product
export async function POST(request: NextRequest) {
  try {
    const pos = await requirePosMenu(IAM.posCatalog);
    if (pos.error) return pos.error;
    const db = createPgClient();
    const body = (await request.json()) as ProductCreatePayload;
    const {
      sku,
      name,
      description,
      category_id,
      base_price,
      cost_price,
      xp = 0,
      xp_points,
      station,
      is_active = true,
      variants = [],
      modifierGroups = []
    } = body;

    // Validate required fields
    if (!sku || !name || !base_price) {
      return NextResponse.json(
        { success: false, error: 'SKU, name, and base_price are required' },
        { status: 400 }
      );
    }

    // EPIC-039 Fase A — field merchandise (product_kind, tautan purchasing,
    // stok awal, berat/dimensi utk ongkir Fase C)
    const merchColumns = buildMerchandiseColumns(body);
    if (!merchColumns.ok) {
      return NextResponse.json(
        { success: false, error: merchColumns.error },
        { status: 400 }
      );
    }

    // Insert product
    const rawMinXp = (body as { min_xp?: unknown }).min_xp;
    const productPayload = {
      ...merchColumns.columns,
      sku,
      name,
      description,
      category_id,
      base_price,
      cost_price: cost_price || 0,
      xp_points: Math.max(0, Number(xp_points ?? xp) || 0),
      station: normalizeStation(station),
      is_active,
      // Produk privilege member (EPIC-011 Fase C): null = produk umum
      min_xp:
        rawMinXp === undefined || rawMinXp === null || Number(rawMinXp) <= 0
          ? null
          : Math.floor(Number(rawMinXp)),
    };

    let { data: product, error: productError } = await db
      .from('pos_products')
      .insert(productPayload)
      .select()
      .single();

    if (productError?.code === '42703') {
      const legacyPayload: Omit<typeof productPayload, 'xp_points' | 'station'> & { xp?: number; station?: string } = { ...productPayload };
      legacyPayload.xp = productPayload.xp_points;
      delete (legacyPayload as { xp_points?: number }).xp_points;
      delete (legacyPayload as { station?: string }).station;
      delete (legacyPayload as { min_xp?: number | null }).min_xp;
      for (const key of Object.keys(merchColumns.columns)) {
        delete (legacyPayload as Record<string, unknown>)[key];
      }

      const legacyRetry = await db
        .from('pos_products')
        .insert(legacyPayload)
        .select()
        .single();

      if (legacyRetry.error?.code === '42703') {
        const payloadWithoutXp: Omit<typeof productPayload, 'xp_points' | 'station'> = { ...productPayload };
        delete (payloadWithoutXp as { xp_points?: number }).xp_points;
        delete (payloadWithoutXp as { station?: string }).station;
        delete (payloadWithoutXp as { min_xp?: number | null }).min_xp;
        for (const key of Object.keys(merchColumns.columns)) {
          delete (payloadWithoutXp as Record<string, unknown>)[key];
        }
        const plainRetry = await db
          .from('pos_products')
          .insert(payloadWithoutXp)
          .select()
          .single();
        product = plainRetry.data;
        productError = plainRetry.error;
      } else {
        product = legacyRetry.data;
        productError = legacyRetry.error;
      }
    }

    if (productError) throw productError;
    if (!product) throw new Error('Failed to create product');

    // Insert variants if provided
    if (variants.length > 0) {
      const variantsData = variants.map((v: ProductVariantPayload) => ({
        product_id: product.id,
        name: v.name,
        group_name: v.group_name,
        price_adjustment: v.price_adjustment || 0,
        display_order: v.display_order || 0
      }));

      const { error: variantError } = await db
        .from('pos_product_variants')
        .insert(variantsData);

      if (variantError) throw variantError;
    }

    // Insert modifier groups and modifiers if provided
    for (const group of modifierGroups) {
      // Insert modifier group
      const { data: modifierGroup, error: groupError } = await db
        .from('pos_modifier_groups')
        .insert({
          name: group.name,
          min_selection: group.min_selection || 0,
          max_selection: group.max_selection || 1,
          display_order: group.display_order || 0
        })
        .select()
        .single();

      if (groupError) throw groupError;

      // Link product to modifier group
      const { error: linkError } = await db
        .from('pos_product_modifiers')
        .insert({
          product_id: product.id,
          modifier_group_id: modifierGroup.id
        });

      if (linkError) throw linkError;

      // Insert modifiers
      if (group.modifiers && group.modifiers.length > 0) {
        const modifiersData = group.modifiers.map((m: ProductModifierPayload) => ({
          group_id: modifierGroup.id,
          name: m.name,
          price_adjustment: m.price_adjustment || 0,
          display_order: m.display_order || 0
        }));

        const { error: modifierError } = await db
          .from('pos_modifiers')
          .insert(modifiersData);

        if (modifierError) throw modifierError;
      }
    }

    // Fetch complete product with relations
    const { data: completeProduct } = await db
      .from('pos_products')
      .select(`
        *,
        variants:pos_product_variants(*),
        modifiers:pos_product_modifiers(
          modifier_group:pos_modifier_groups(
            id,
            name,
            min_selection,
            max_selection,
            display_order,
            modifiers:pos_modifiers(*)
          )
        )
      `)
      .eq('id', product.id)
      .single();

    return NextResponse.json({
      success: true,
      data: completeProduct ? withProductXpAlias(completeProduct as Record<string, unknown>) : null,
    });
  } catch (error: unknown) {
    console.error('Error creating product:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
