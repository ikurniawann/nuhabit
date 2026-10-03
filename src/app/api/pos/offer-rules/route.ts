import { NextRequest, NextResponse } from "next/server";
import { getPosSession, successResponse } from "@/lib/api/auth";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
import { loadActiveOfferEvalRules } from "@/lib/promo/offer-pos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Penawaran aktif utk banner kasir + pratinjau diskon di klien.
 * `?customer_id=` mengisi pemakaian member supaya kuota per member di klien
 * sama dengan server. Kode pembuka tidak pernah dikirim ke klien.
 */
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const venue = await getCrmDefaultVenue(createPgClient());
    if (!venue.companyId || !venue.branchId) {
      return successResponse([]);
    }

    const rawCustomer = request.nextUrl.searchParams.get("customer_id");
    const { details, rules } = await loadActiveOfferEvalRules({
      companyId: venue.companyId,
      branchId: venue.branchId,
      customerId: rawCustomer && UUID.test(rawCustomer) ? rawCustomer : null,
    });
    const evalById = new Map(rules.map((rule) => [rule.id, rule]));

    const data = details.map((rule) => ({
      id: rule.id,
      offer_type: rule.offer_type,
      name: rule.name,
      description: rule.description,
      valid_from: rule.valid_from,
      valid_until: rule.valid_until,
      bundle_price: rule.bundle_price != null ? Number(rule.bundle_price) : null,
      buy_qty: rule.buy_qty,
      get_qty: rule.get_qty,
      get_mode: rule.get_mode,
      volume_basis: rule.volume_basis,
      volume_min: rule.volume_min != null ? Number(rule.volume_min) : null,
      discount_type: rule.discount_type,
      discount_value:
        rule.discount_value != null ? Number(rule.discount_value) : null,
      requires_code: Boolean(rule.unlock_code),
      is_exclusive: rule.is_exclusive,
      items: rule.items.map((item) => ({
        role: item.role,
        product_id: item.product_id ?? "",
        product_name: item.product_name ?? item.category_name ?? null,
        qty: Number(item.qty) || 1,
      })),
      eval: evalById.get(rule.id),
    }));

    return successResponse(data);
  } catch (err) {
    console.error("[pos/offer-rules] GET failed:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat promo aktif" },
      { status: 500 }
    );
  }
}
