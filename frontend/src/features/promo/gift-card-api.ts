import type {
  GiftCard,
  GiftCardConfigValues,
  GiftCardIssueValues,
  GiftCardLedgerEntry,
  GiftCardMember,
  GiftCardReloadValues,
} from "./gift-card-types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? fallback;
  } catch {
    // body bukan JSON — pakai fallback
  }
  throw new Error(message);
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT",
  payload: unknown,
  fallback: string
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

export const fetchGiftCards = (params?: {
  status?: string;
  q?: string;
  phone?: string;
  customer_id?: string;
}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return getJson<GiftCard[]>(
    `/api/promo/gift-cards${qs ? `?${qs}` : ""}`,
    "Gagal memuat gift card"
  );
};

export const issueGiftCard = (values: GiftCardIssueValues) =>
  sendJson<GiftCard | { count: number; codes: string[] }>(
    "/api/promo/gift-cards",
    "POST",
    values,
    "Gagal menerbitkan gift card"
  );

export const toggleGiftCard = (id: string, isActive: boolean) =>
  sendJson<{ id: string; status: string }>(
    `/api/promo/gift-cards/${id}`,
    "PATCH",
    { is_active: isActive },
    "Gagal memperbarui gift card"
  );

/** EPIC-034 Fase C — koreksi saldo ber-audit (delta bertanda + alasan). */
export const adjustGiftCard = (id: string, delta: number, reason: string) =>
  sendJson<{ balanceAfter: number; statusAfter: string }>(
    `/api/promo/gift-cards/${id}/adjust`,
    "POST",
    { delta, reason },
    "Gagal mengoreksi saldo"
  );

export const fetchGiftCardConfig = () =>
  getJson<GiftCardConfigValues>(
    "/api/promo/gift-card-config",
    "Gagal memuat konfigurasi gift card"
  );

export const saveGiftCardConfig = (values: Partial<GiftCardConfigValues>) =>
  sendJson<GiftCardConfigValues>(
    "/api/promo/gift-card-config",
    "PUT",
    values,
    "Gagal menyimpan konfigurasi gift card"
  );

export const fetchGiftCardLedger = (id: string) =>
  getJson<GiftCardLedgerEntry[]>(
    `/api/promo/gift-cards/${id}/ledger`,
    "Gagal memuat riwayat"
  );

export const reloadGiftCard = (id: string, values: GiftCardReloadValues) =>
  sendJson<{ balanceAfter: number; statusAfter: string }>(
    `/api/promo/gift-cards/${id}/reload`,
    "POST",
    values,
    "Gagal reload gift card"
  );

/** customer_id null = lepas tautan member. */
export const linkGiftCardMember = (id: string, customerId: string | null) =>
  sendJson<{ id: string; customer_id: string | null }>(
    `/api/promo/gift-cards/${id}`,
    "PATCH",
    { customer_id: customerId },
    "Gagal menautkan member"
  );

export const lookupMembersByPhone = (phone: string) =>
  getJson<GiftCardMember[]>(
    `/api/promo/gift-cards/member-lookup?phone=${encodeURIComponent(phone)}`,
    "Gagal mencari member"
  );
