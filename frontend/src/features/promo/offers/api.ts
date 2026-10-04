import type { OfferRule, OfferRulePayload, OfferType } from "./types";

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || "Request gagal");
  }
  return body;
}

export async function fetchOfferRules(type: OfferType): Promise<OfferRule[]> {
  const res = await fetch(`/api/promo/offers?type=${type}`, { cache: "no-store" });
  const body = await parseJson(res);
  return body.data ?? [];
}

export async function createOfferRule(
  payload: OfferRulePayload
): Promise<OfferRule> {
  const res = await fetch("/api/promo/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseJson(res);
  return body.data;
}

export async function updateOfferRule(
  id: string,
  payload: OfferRulePayload
): Promise<OfferRule> {
  const res = await fetch(`/api/promo/offers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseJson(res);
  return body.data;
}

export async function deleteOfferRule(id: string): Promise<void> {
  const res = await fetch(`/api/promo/offers/${id}`, { method: "DELETE" });
  if (res.status === 204) return;
  await parseJson(res);
}
