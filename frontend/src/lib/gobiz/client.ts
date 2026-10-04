/**
 * Klien HTTP GoBiz (Direct Integration) — OAuth2 client_credentials + endpoint
 * GoFood yang dipakai POS. Referensi: developer.gobiz.com
 *   PUT  /integrations/gofood/outlets/{outlet}/v1/orders/{type}/{id}/accepted
 *   PUT  /integrations/gofood/outlets/{outlet}/v1/orders/{type}/{id}/cancelled
 *   PUT  /integrations/gofood/outlets/{outlet}/v1/orders/{type}/{id}/food-prepared
 *   PUT  /integrations/gofood/outlets/{outlet}/v1/catalog
 *   GET  /integrations/gofood/outlets/{outlet}/v2/catalog
 *   POST /integrations/partner/v1/notification-subscriptions
 */

import type { GobizConfig } from "./config";
import { GOBIZ_SCOPES } from "./config";
import type { GobizCatalogPayload, GofoodCancelReasonCode, GofoodOrderType } from "./types";

export class GobizApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "GobizApiError";
    this.status = status;
    this.body = body;
  }
}

type FetchLike = typeof fetch;

type TokenCacheEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenCacheEntry>();

function cacheKey(config: GobizConfig) {
  return `${config.environment}:${config.oauthUrl}:${config.clientId}`;
}

/** Utk test / rotasi kredensial. */
export function clearGobizTokenCache() {
  tokenCache.clear();
}

function errorMessageFrom(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error_description === "string") return record.error_description;
    if (typeof record.error === "string") return record.error;
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      const first = record.errors[0] as Record<string, unknown>;
      if (typeof first?.message === "string") return first.message;
    }
  }
  return fallback;
}

/** Token OAuth2 (cache in-memory, refresh 60 dtk sebelum kedaluwarsa). */
export async function getGobizAccessToken(
  config: GobizConfig,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now
): Promise<string> {
  const key = cacheKey(config);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > now()) return cached.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: GOBIZ_SCOPES,
  });
  const response = await fetchImpl(config.oauthUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof json.access_token !== "string") {
    throw new GobizApiError(
      errorMessageFrom(json, `Gagal mengambil token GoBiz (${response.status})`),
      response.status,
      json
    );
  }
  const expiresIn = Number(json.expires_in) || 3599;
  tokenCache.set(key, {
    token: json.access_token,
    expiresAt: now() + Math.max(30, expiresIn - 60) * 1000,
  });
  return json.access_token;
}

export async function gobizRequest<T = Record<string, unknown>>(
  config: GobizConfig,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  fetchImpl: FetchLike = fetch
): Promise<T> {
  const token = await getGobizAccessToken(config, fetchImpl);
  const response = await fetchImpl(`${config.apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 401) {
    // Token ditolak → buang cache supaya percobaan berikutnya minta token baru.
    tokenCache.delete(cacheKey(config));
  }
  if (!response.ok || json.success === false) {
    throw new GobizApiError(
      errorMessageFrom(json, `GoBiz ${method} ${path} gagal (${response.status})`),
      response.status,
      json
    );
  }
  return json as T;
}

function orderPath(config: GobizConfig, orderType: GofoodOrderType, orderId: string, action: string) {
  return `/integrations/gofood/outlets/${encodeURIComponent(config.outletId)}/v1/orders/${orderType}/${encodeURIComponent(orderId)}/${action}`;
}

export function acceptGofoodOrder(
  config: GobizConfig,
  orderType: GofoodOrderType,
  orderId: string,
  fetchImpl: FetchLike = fetch
) {
  return gobizRequest(config, "PUT", orderPath(config, orderType, orderId, "accepted"), {}, fetchImpl);
}

export function rejectGofoodOrder(
  config: GobizConfig,
  orderType: GofoodOrderType,
  orderId: string,
  reason: { code: GofoodCancelReasonCode; description: string },
  fetchImpl: FetchLike = fetch
) {
  return gobizRequest(
    config,
    "PUT",
    orderPath(config, orderType, orderId, "cancelled"),
    {
      cancel_reason_code: reason.code,
      cancel_reason_description: reason.description.trim().padEnd(3, "."),
    },
    fetchImpl
  );
}

export function markGofoodFoodReady(
  config: GobizConfig,
  orderType: GofoodOrderType,
  orderId: string,
  fetchImpl: FetchLike = fetch
) {
  return gobizRequest(
    config,
    "PUT",
    orderPath(config, orderType, orderId, "food-prepared"),
    { country_code: "ID" },
    fetchImpl
  );
}

export function pushGofoodCatalog(
  config: GobizConfig,
  payload: GobizCatalogPayload,
  fetchImpl: FetchLike = fetch
) {
  return gobizRequest<{ success: boolean; data?: { request_id?: string } }>(
    config,
    "PUT",
    `/integrations/gofood/outlets/${encodeURIComponent(config.outletId)}/v1/catalog`,
    payload,
    fetchImpl
  );
}

export function fetchGofoodCatalog(config: GobizConfig, fetchImpl: FetchLike = fetch) {
  return gobizRequest(
    config,
    "GET",
    `/integrations/gofood/outlets/${encodeURIComponent(config.outletId)}/v2/catalog`,
    undefined,
    fetchImpl
  );
}

export function subscribeGobizNotification(
  config: GobizConfig,
  event: string,
  url: string,
  fetchImpl: FetchLike = fetch
) {
  return gobizRequest(
    config,
    "POST",
    "/integrations/partner/v1/notification-subscriptions",
    { event, url, active: true },
    fetchImpl
  );
}
