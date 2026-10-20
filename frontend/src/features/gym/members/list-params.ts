/** Filter daftar member yang hidup di URL, supaya tampilan bisa dibagikan dan dibuka ulang. */

export const MEMBER_FLAGS = [
  { key: "active_pass", label: "Pass aktif" },
  { key: "has_credits", label: "Punya kredit" },
  { key: "expiring", label: "Kredit kedaluwarsa dalam 14 hari" },
  { key: "inactive", label: "Tidak datang 30+ hari" },
] as const;

export type MemberFlag = (typeof MEMBER_FLAGS)[number]["key"];

export interface MemberListParams {
  q: string;
  branch_id: string;
  flags: MemberFlag[];
  page: number;
}

export const MEMBER_PAGE_SIZE = 25;

const FLAG_KEYS = MEMBER_FLAGS.map((f) => f.key);

/** Baca filter dari query string; nilai yang tidak dikenal diabaikan. */
export function parseMemberParams(search: URLSearchParams): MemberListParams {
  const page = Number(search.get("page"));
  return {
    q: search.get("q")?.trim() ?? "",
    branch_id: search.get("branch_id") ?? "",
    flags: FLAG_KEYS.filter((key) => search.get(key) === "1"),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Query string halaman: hanya nilai yang bukan default, urutan tetap. */
export function memberParamsToSearch(params: MemberListParams): string {
  const out = new URLSearchParams();
  if (params.q) out.set("q", params.q);
  if (params.branch_id) out.set("branch_id", params.branch_id);
  for (const key of FLAG_KEYS) if (params.flags.includes(key)) out.set(key, "1");
  if (params.page > 1) out.set("page", String(params.page));
  return out.toString();
}

/** Query string API: filter halaman ditambah ukuran halaman. */
export function memberApiQuery(params: MemberListParams): string {
  const out = new URLSearchParams(memberParamsToSearch(params));
  out.set("page_size", String(MEMBER_PAGE_SIZE));
  return out.toString();
}

/** Nyalakan atau matikan satu filter; halaman kembali ke 1. */
export function toggleFlag(params: MemberListParams, key: MemberFlag): MemberListParams {
  const flags = params.flags.includes(key) ? params.flags.filter((f) => f !== key) : [...params.flags, key];
  return { ...params, flags, page: 1 };
}

export function pageCount(total: number, pageSize = MEMBER_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
