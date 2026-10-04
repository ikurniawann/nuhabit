import { parseCrmResponse } from "../http";

export interface GoogleReview {
  id: string;
  reviewer_name: string;
  reviewer_photo_url: string | null;
  star_rating: number;
  comment: string | null;
  review_created_at: string;
  reply_comment: string | null;
  reply_updated_at: string | null;
  status: "baru" | "dibalas" | "diabaikan";
  is_complaint: boolean;
  first_reply_seconds: number | null;
  replied_by_name: string | null;
  sla_breached: boolean;
  waiting_seconds: number;
  location_id: string | null;
  pending_reply_comment: string | null;
  reply_approval_status: "pending_approval" | "approved" | "rejected" | null;
  pending_by_name: string | null;
}

export interface ReviewSummary {
  total: number;
  belum_dibalas: number;
  komplain_terbuka: number;
  menunggu_persetujuan: number;
  rata_rating: string | null;
  rata_waktu_balas: string | null;
}

export interface ReviewLocation {
  location_id: string;
  total: number;
}

export type ReviewFilters = { status: string; rating: string; location: string };

export interface ReviewList {
  reviews: GoogleReview[];
  summary: ReviewSummary | null;
  integration: { configured: boolean } | null;
  locations: ReviewLocation[];
  canApprove: boolean;
}

export type ReviewAction =
  | { action: "sync" }
  | { action: "reply"; id: string; comment: string }
  | { action: "approve_reply"; id: string }
  | { action: "reject_reply"; id: string }
  | { action: "ignore"; id: string };

/** Kredensial Google Business Profile; rahasia hanya dikirim sebagai samaran. */
export interface GoogleBusinessConfig {
  client_id: string;
  account_id: string;
  location_id: string;
  has_client_secret: boolean;
  client_secret_masked: string | null;
  has_refresh_token: boolean;
  refresh_token_masked: string | null;
  configured: boolean;
}

export type GoogleBusinessForm = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  account_id: string;
  location_id: string;
};

export function reviewSearchParams(filters: ReviewFilters): string {
  const sp = new URLSearchParams();
  if (filters.status !== "all") sp.set("status", filters.status);
  if (filters.rating !== "all") sp.set("rating", filters.rating);
  if (filters.location !== "all") sp.set("location", filters.location);
  return sp.toString();
}

export async function fetchReviews(filters: ReviewFilters): Promise<ReviewList> {
  const response = await fetch(`/api/crm/reviews?${reviewSearchParams(filters)}`, { cache: "no-store" });
  const json = await parseCrmResponse<{
    data: Partial<Omit<ReviewList, "canApprove">> & { viewer?: { canApprove?: boolean } };
  }>(response, "Gagal memuat ulasan");
  return {
    reviews: json.data.reviews ?? [],
    summary: json.data.summary ?? null,
    integration: json.data.integration ?? null,
    locations: json.data.locations ?? [],
    canApprove: Boolean(json.data.viewer?.canApprove),
  };
}

/** Data hasil aksi (mis. `{ inserted, updated }` untuk sync, `{ pending }` untuk reply). */
export type ReviewActionResult = { inserted?: number; updated?: number; pending?: boolean } | true;

export async function postReviewAction(body: ReviewAction): Promise<ReviewActionResult> {
  const response = await fetch("/api/crm/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await parseCrmResponse<{ data?: ReviewActionResult }>(response, "Gagal memproses");
  return json.data ?? true;
}

export async function fetchGoogleBusinessConfig(): Promise<GoogleBusinessConfig> {
  const response = await fetch("/api/settings/google-business", { cache: "no-store" });
  const json = await parseCrmResponse<{ data: GoogleBusinessConfig }>(response, "Gagal memuat konfigurasi");
  return json.data;
}

export async function saveGoogleBusinessConfig(form: GoogleBusinessForm): Promise<void> {
  const response = await fetch("/api/settings/google-business", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  await parseCrmResponse(response, "Gagal menyimpan");
}

export async function deleteGoogleBusinessConfig(): Promise<void> {
  await fetch("/api/settings/google-business", { method: "DELETE" });
}
