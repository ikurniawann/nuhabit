import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiUser } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { loadGrantedMenuCodesForUser } from "@/lib/iam/has-menu";
import {
  SEARCH_LIMIT_PER_SOURCE,
  allowedSources,
  groupHitsBySource,
  isSearchable,
  likePattern,
  normalizeSearchQuery,
  rankSearchHits,
  type SearchHit,
  type SearchSourceKey,
} from "@/lib/desktop/search";

/**
 * Spotlight desktop: cari transaksi, member, produk, bahan baku, karyawan,
 * dan dokumen dalam satu kotak. Sumber dibatasi menu IAM pengguna — hasil
 * tidak boleh membocorkan data modul yang tidak boleh ia buka.
 */
export const dynamic = "force-dynamic";

type SqlSource = {
  sql: string;
  map: (row: Record<string, unknown>) => SearchHit;
};

function buildSource(key: SearchSourceKey): SqlSource | null {
  const limit = SEARCH_LIMIT_PER_SOURCE;
  switch (key) {
    case "order":
      return {
        sql: `SELECT id::text, order_number, total_amount, status, created_at
              FROM pos.pos_orders
              WHERE order_number ILIKE $1 ESCAPE '\\'
              ORDER BY created_at DESC LIMIT ${limit}`,
        map: (row) => ({
          source: "order",
          id: String(row.id),
          title: String(row.order_number ?? "-"),
          subtitle: `${row.status ?? ""} · Rp ${Number(row.total_amount ?? 0).toLocaleString("id-ID")}`,
          href: `/dashboard/pos/orders?q=${encodeURIComponent(String(row.order_number ?? ""))}`,
        }),
      };
    case "member":
      return {
        sql: `SELECT id::text, name, phone, membership_tier
              FROM pos.pos_customers
              WHERE (name ILIKE $1 ESCAPE '\\' OR phone ILIKE $1 ESCAPE '\\') AND is_active
              ORDER BY name NULLS LAST LIMIT ${limit}`,
        map: (row) => ({
          source: "member",
          id: String(row.id),
          title: String(row.name || row.phone || "-"),
          subtitle: `${row.phone ?? ""}${row.membership_tier ? ` · ${row.membership_tier}` : ""}`,
          href: `/dashboard/crm/members?q=${encodeURIComponent(String(row.phone ?? row.name ?? ""))}`,
        }),
      };
    case "product":
      return {
        sql: `SELECT id::text, name, sku, base_price
              FROM pos.pos_products
              WHERE (name ILIKE $1 ESCAPE '\\' OR sku ILIKE $1 ESCAPE '\\') AND is_active
              ORDER BY name LIMIT ${limit}`,
        map: (row) => ({
          source: "product",
          id: String(row.id),
          title: String(row.name ?? "-"),
          subtitle: `${row.sku ?? ""} · Rp ${Number(row.base_price ?? 0).toLocaleString("id-ID")}`,
          href: `/dashboard/pos/products?q=${encodeURIComponent(String(row.name ?? ""))}`,
        }),
      };
    case "material":
      return {
        sql: `SELECT id::text, kode, nama
              FROM item.raw_materials
              WHERE (nama ILIKE $1 ESCAPE '\\' OR kode ILIKE $1 ESCAPE '\\') AND deleted_at IS NULL
              ORDER BY nama LIMIT ${limit}`,
        map: (row) => ({
          source: "material",
          id: String(row.id),
          title: String(row.nama ?? "-"),
          subtitle: String(row.kode ?? ""),
          href: `/dashboard/items/raw-material/master/materials?q=${encodeURIComponent(String(row.kode ?? ""))}`,
        }),
      };
    case "employee":
      return {
        sql: `SELECT id::text, full_name, nip, email
              FROM hris.employees
              WHERE (full_name ILIKE $1 ESCAPE '\\' OR nip ILIKE $1 ESCAPE '\\') AND is_active
              ORDER BY full_name LIMIT ${limit}`,
        map: (row) => ({
          source: "employee",
          id: String(row.id),
          title: String(row.full_name ?? "-"),
          subtitle: `${row.nip ?? ""}${row.email ? ` · ${row.email}` : ""}`,
          href: `/dashboard/hris/kepegawaian/users?q=${encodeURIComponent(String(row.full_name ?? ""))}`,
        }),
      };
    case "document":
      return {
        sql: `SELECT id::text, name, kind
              FROM dataroom.nodes
              WHERE name ILIKE $1 ESCAPE '\\'
              ORDER BY name LIMIT ${limit}`,
        map: (row) => ({
          source: "document",
          id: String(row.id),
          title: String(row.name ?? "-"),
          subtitle: String(row.kind ?? ""),
          href: `/dashboard/dataroom`,
        }),
      };
    default:
      return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const query = normalizeSearchQuery(request.nextUrl.searchParams.get("q"));
    if (!isSearchable(query)) {
      return NextResponse.json({ success: true, data: { groups: [], query } });
    }

    const granted = await loadGrantedMenuCodesForUser(user.id, user.role);
    const sources = allowedSources(granted);
    const pattern = likePattern(query);
    const pool = getPool();

    const results = await Promise.all(
      sources.map(async (source) => {
        const def = buildSource(source.key);
        if (!def) return [] as SearchHit[];
        try {
          const { rows } = await pool.query(def.sql, [pattern]);
          return rows.map((row) => def.map(row as Record<string, unknown>));
        } catch (error) {
          // Satu tabel bermasalah (mis. modul belum dimigrasi) tidak boleh
          // menggagalkan seluruh pencarian.
          console.warn(`[desktop/search] sumber ${source.key} gagal:`, error);
          return [] as SearchHit[];
        }
      })
    );

    const hits = rankSearchHits(results.flat(), query);
    return NextResponse.json({ success: true, data: { groups: groupHitsBySource(hits), query } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[desktop/search] gagal:", error);
    return NextResponse.json({ success: false, error: "Pencarian gagal" }, { status: 500 });
  }
}
