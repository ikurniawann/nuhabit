/**
 * Spotlight Arkiv OS — mencari DATA, bukan cuma nama aplikasi.
 *
 * Berkas ini murni metadata + pemeringkatan (tanpa DB) supaya bisa diuji;
 * kueri SQL-nya ada di src/app/api/desktop/search/route.ts. Tiap sumber
 * menempel pada prefiks menu IAM: pencarian tidak boleh membocorkan data
 * dari modul yang tidak boleh dibuka pengguna.
 */

export type SearchSourceKey = "order" | "member" | "product" | "material" | "employee" | "document";

export interface SearchSourceDef {
  key: SearchSourceKey;
  label: string;
  /** Prefiks menu IAM; salah satu harus dimiliki pengguna. */
  iamPrefixes: readonly string[];
  /** Halaman yang dibuka saat hasil dipilih. */
  href: string;
}

export const SEARCH_SOURCES: readonly SearchSourceDef[] = [
  { key: "order", label: "Transaksi", iamPrefixes: ["pos.reports", "pos.operations"], href: "/dashboard/pos/orders" },
  { key: "member", label: "Member", iamPrefixes: ["crm.members", "crm"], href: "/dashboard/crm/members" },
  { key: "product", label: "Produk", iamPrefixes: ["pos.catalog", "items.product"], href: "/dashboard/pos/products" },
  { key: "material", label: "Bahan Baku", iamPrefixes: ["items.raw-material"], href: "/dashboard/items/raw-material/master/materials" },
  { key: "employee", label: "Karyawan", iamPrefixes: ["hris.kepegawaian", "hris"], href: "/dashboard/hris/kepegawaian/users" },
  { key: "document", label: "Dataroom", iamPrefixes: ["dataroom"], href: "/dashboard/dataroom" },
] as const;

export interface SearchHit {
  source: SearchSourceKey;
  id: string;
  title: string;
  subtitle?: string | null;
  href: string;
}

/** Panjang minimal sebelum menembak DB — 1 huruf akan menarik separuh tabel. */
export const MIN_SEARCH_LENGTH = 2;
export const SEARCH_LIMIT_PER_SOURCE = 5;

export function normalizeSearchQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}

export function isSearchable(query: string): boolean {
  return normalizeSearchQuery(query).length >= MIN_SEARCH_LENGTH;
}

/** Pola LIKE aman: % dan _ dari pengguna di-escape agar tidak jadi wildcard. */
export function likePattern(query: string): string {
  const escaped = normalizeSearchQuery(query).replace(/([%_\\])/g, "\\$1");
  return `%${escaped}%`;
}

export function allowedSources(grantedMenuCodes: readonly string[]): SearchSourceDef[] {
  // Menu kosong = instalasi tanpa data IAM; jangan sembunyikan semuanya.
  if (grantedMenuCodes.length === 0) return [...SEARCH_SOURCES];
  return SEARCH_SOURCES.filter((source) =>
    source.iamPrefixes.some((prefix) =>
      grantedMenuCodes.some((code) => code === prefix || code.startsWith(`${prefix}.`))
    )
  );
}

/**
 * Yang diawali kata kunci naik ke atas (mengetik "5-01" harus memunculkan
 * meja 5-01 lebih dulu daripada catatan yang kebetulan memuat "5-01").
 */
export function rankSearchHits(hits: SearchHit[], query: string): SearchHit[] {
  const q = normalizeSearchQuery(query).toLowerCase();
  const score = (hit: SearchHit) => {
    const title = hit.title.toLowerCase();
    if (title === q) return 0;
    if (title.startsWith(q)) return 1;
    if (title.includes(q)) return 2;
    return 3;
  };
  return [...hits].sort((a, b) => score(a) - score(b) || a.title.localeCompare(b.title));
}

export function groupHitsBySource(hits: SearchHit[]): Array<{ source: SearchSourceKey; label: string; items: SearchHit[] }> {
  const out: Array<{ source: SearchSourceKey; label: string; items: SearchHit[] }> = [];
  for (const def of SEARCH_SOURCES) {
    const items = hits.filter((hit) => hit.source === def.key);
    if (items.length > 0) out.push({ source: def.key, label: def.label, items });
  }
  return out;
}
