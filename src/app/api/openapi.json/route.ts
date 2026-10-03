import { NextResponse } from "next/server";
import { getSessionUserFromCookies } from "@/lib/auth/session";
import generated from "@/lib/api-docs/openapi-paths.generated.json";

/**
 * EPIC-042: spesifikasi OpenAPI 3.0 seluruh endpoint /api/* — dikonsumsi
 * agent eksternal (OpenClaw dsb.) untuk auto-discovery tools.
 *
 * Basis: inventaris hasil scan route (scripts/generate-openapi.mjs, di-commit)
 * + kurasi skema utk endpoint inti POS. Butuh autentikasi (sesi ATAU Bearer
 * token) — daftar endpoint internal bukan konsumsi publik.
 */

const CURATED_PATHS: Record<string, unknown> = {
  "/api/pos/orders": {
    get: {
      tags: ["pos"],
      summary: "Daftar order POS (filter status/payment/tanggal/q)",
      parameters: [
        { name: "status", in: "query", schema: { type: "string" } },
        { name: "payment_status", in: "query", schema: { type: "string" } },
        { name: "payment_method", in: "query", schema: { type: "string" } },
        { name: "date_from", in: "query", schema: { type: "string", format: "date" } },
        { name: "date_to", in: "query", schema: { type: "string", format: "date" } },
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer" } },
      ],
      responses: { "200": { description: "Daftar order + stall_name per baris" } },
      security: [{ bearerAuth: [] }],
    },
    post: {
      tags: ["pos"],
      summary: "Buat order + pembayaran (ark_coin butuh ark_coins_used = total)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["order_type", "items", "total_amount", "payment_method"],
              properties: {
                order_type: {
                  type: "string",
                  enum: ["dine_in", "takeaway", "delivery", "self_order"],
                },
                customer_id: { type: "string", format: "uuid" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["product_id", "product_name", "quantity", "unit_price"],
                    properties: {
                      product_id: { type: "string", format: "uuid" },
                      product_name: { type: "string" },
                      quantity: { type: "number" },
                      unit_price: { type: "number" },
                      subtotal: { type: "number" },
                      total_amount: { type: "number" },
                    },
                  },
                },
                subtotal: { type: "number" },
                discount_amount: { type: "number" },
                tax_amount: { type: "number" },
                total_amount: { type: "number" },
                payment_method: {
                  type: "string",
                  enum: ["cash", "qris", "credit", "ark_coin", "nfc_tab", "gift_card"],
                },
                amount_paid: { type: "number" },
                ark_coins_used: { type: "number" },
                payment_status: { type: "string", enum: ["paid", "pending"] },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description:
            "Order dibuat; respons memuat ark_balance_after, xp_total_after, crm_xp utk struk",
        },
      },
      security: [{ bearerAuth: [] }],
    },
  },
};

export async function GET() {
  const user = await getSessionUserFromCookies();
  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  const gen = generated as { generated_route_count: number; paths: Record<string, unknown> };
  const spec = {
    openapi: "3.0.3",
    info: {
      title: "NüHabit OS API",
      version: "1.0.0",
      description:
        "Seluruh endpoint /api/* NüHabit OS. Autentikasi: header 'Authorization: Bearer arkiv_...' (Open API token, dikelola admin di dashboard) atau cookie sesi. Scope token: '*' atau '<modul>:read|write' (modul: pos, member, hris, inventory, crm, config, reports, other). Method GET=read, selainnya write.",
    },
    servers: [{ url: "https://dashboard.suluinwounderland.com" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "arkiv_<hex>" },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: { ...gen.paths, ...CURATED_PATHS },
  };

  return NextResponse.json(spec);
}
