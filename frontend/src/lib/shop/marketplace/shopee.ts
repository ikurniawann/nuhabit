// EPIC-039 Fase F — adapter Shopee Open Platform v2.
// Kredensial partner via env: SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY,
// SHOPEE_API_BASE (default produksi; utk sandbox set
// https://partner.test-stable.shopeemobile.com).
//
// Tanda tangan (dok resmi open.shopee.com):
//   * public API (auth/token): HMAC-SHA256(key, partner_id+path+timestamp)
//   * shop API: HMAC-SHA256(key, partner_id+path+timestamp+access_token+shop_id)

import { createHmac } from "crypto";
import {
  type MarketplaceAccountRow,
  type MarketplaceAdapter,
  type MarketplaceListing,
  type MarketplaceOrder,
  type TokenBundle,
  MarketplaceError,
} from "./types";

const DEFAULT_BASE = "https://partner.shopeemobile.com";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new MarketplaceError(`${name} belum dikonfigurasi di environment server`, 503);
  }
  return value;
}

function apiBase(): string {
  return process.env.SHOPEE_API_BASE || DEFAULT_BASE;
}

function sign(path: string, timestamp: number, accessToken?: string, shopId?: string): string {
  const partnerId = env("SHOPEE_PARTNER_ID");
  const partnerKey = env("SHOPEE_PARTNER_KEY");
  const base = accessToken && shopId
    ? `${partnerId}${path}${timestamp}${accessToken}${shopId}`
    : `${partnerId}${path}${timestamp}`;
  return createHmac("sha256", partnerKey).update(base).digest("hex");
}

async function shopeeFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    query?: Record<string, string | number>;
    body?: Record<string, unknown>;
    account?: MarketplaceAccountRow;
  } = {}
): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const partnerId = env("SHOPEE_PARTNER_ID");
  const params = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
  });

  if (options.account) {
    const token = options.account.access_token;
    if (!token) throw new MarketplaceError("Toko belum terhubung (token kosong)", 401);
    params.set("access_token", token);
    params.set("shop_id", options.account.shop_id);
    params.set("sign", sign(path, timestamp, token, options.account.shop_id));
  } else {
    params.set("sign", sign(path, timestamp));
  }

  for (const [key, value] of Object.entries(options.query ?? {})) {
    params.set(key, String(value));
  }

  const response = await fetch(`${apiBase()}${path}?${params.toString()}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  } & T;
  if (!response.ok || (json.error && json.error !== "")) {
    throw new MarketplaceError(
      `Shopee ${path}: ${json.error || `HTTP ${response.status}`} ${json.message || ""}`.trim()
    );
  }
  return json;
}

export const shopeeAdapter: MarketplaceAdapter = {
  channel: "shopee",

  buildAuthUrl(redirectUrl: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const path = "/api/v2/shop/auth_partner";
    const params = new URLSearchParams({
      partner_id: env("SHOPEE_PARTNER_ID"),
      timestamp: String(timestamp),
      sign: sign(path, timestamp),
      redirect: redirectUrl,
    });
    return `${apiBase()}${path}?${params.toString()}`;
  },

  async exchangeCode(code: string, shopId: string): Promise<TokenBundle> {
    const json = await shopeeFetch<{
      access_token?: string;
      refresh_token?: string;
      expire_in?: number;
    }>("/api/v2/auth/token/get", {
      method: "POST",
      body: { code, shop_id: Number(shopId), partner_id: Number(env("SHOPEE_PARTNER_ID")) },
    });
    if (!json.access_token || !json.refresh_token) {
      throw new MarketplaceError("Shopee tidak mengembalikan token — coba otorisasi ulang");
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + (Number(json.expire_in) || 14400) * 1000),
    };
  },

  async refreshToken(account: MarketplaceAccountRow): Promise<TokenBundle> {
    if (!account.refresh_token) {
      throw new MarketplaceError("Refresh token kosong — hubungkan ulang toko", 401);
    }
    const json = await shopeeFetch<{
      access_token?: string;
      refresh_token?: string;
      expire_in?: number;
    }>("/api/v2/auth/access_token/get", {
      method: "POST",
      body: {
        refresh_token: account.refresh_token,
        shop_id: Number(account.shop_id),
        partner_id: Number(env("SHOPEE_PARTNER_ID")),
      },
    });
    if (!json.access_token || !json.refresh_token) {
      throw new MarketplaceError("Refresh token Shopee gagal — hubungkan ulang toko", 401);
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + (Number(json.expire_in) || 14400) * 1000),
    };
  },

  async listListings(account: MarketplaceAccountRow): Promise<MarketplaceListing[]> {
    const listings: MarketplaceListing[] = [];
    let offset = 0;
    // Maks 5 halaman × 50 item — cukup utk katalog merchandise; log bila terpotong
    for (let page = 0; page < 5; page++) {
      const list = await shopeeFetch<{
        response?: {
          item?: Array<{ item_id: number; item_status?: string }>;
          has_next_page?: boolean;
          next_offset?: number;
        };
      }>("/api/v2/product/get_item_list", {
        account,
        query: { offset, page_size: 50, item_status: "NORMAL" },
      });

      const items = list.response?.item ?? [];
      if (items.length === 0) break;

      const ids = items.map((item) => item.item_id).join(",");
      const info = await shopeeFetch<{
        response?: {
          item_list?: Array<{ item_id: number; item_name?: string; has_model?: boolean }>;
        };
      }>("/api/v2/product/get_item_base_info", {
        account,
        query: { item_id_list: ids },
      });

      for (const item of info.response?.item_list ?? []) {
        const listing: MarketplaceListing = {
          itemId: String(item.item_id),
          itemName: item.item_name || String(item.item_id),
          models: [],
        };
        if (item.has_model) {
          const models = await shopeeFetch<{
            response?: {
              model?: Array<{
                model_id: number;
                model_name?: string;
                model_sku?: string | null;
              }>;
            };
          }>("/api/v2/product/get_model_list", {
            account,
            query: { item_id: item.item_id },
          });
          listing.models = (models.response?.model ?? []).map((model) => ({
            modelId: String(model.model_id),
            modelName: model.model_name || String(model.model_id),
            modelSku: model.model_sku || null,
          }));
        }
        listings.push(listing);
      }

      if (!list.response?.has_next_page) break;
      offset = Number(list.response?.next_offset) || offset + 50;
    }
    return listings;
  },

  async pushStock(
    account: MarketplaceAccountRow,
    target: { itemId: string; modelId: string | null },
    stock: number
  ): Promise<void> {
    const safeStock = Math.max(0, Math.floor(stock));
    await shopeeFetch("/api/v2/product/update_stock", {
      account,
      method: "POST",
      body: {
        item_id: Number(target.itemId),
        stock_list: [
          {
            model_id: target.modelId ? Number(target.modelId) : 0,
            seller_stock: [{ stock: safeStock }],
          },
        ],
      },
    });
  },

  async pullOrders(account: MarketplaceAccountRow, since: Date): Promise<MarketplaceOrder[]> {
    const timeFrom = Math.floor(since.getTime() / 1000);
    const timeTo = Math.floor(Date.now() / 1000);
    const list = await shopeeFetch<{
      response?: { order_list?: Array<{ order_sn: string }> };
    }>("/api/v2/order/get_order_list", {
      account,
      query: {
        time_range_field: "update_time",
        time_from: timeFrom,
        time_to: timeTo,
        page_size: 50,
      },
    });

    const orderSns = (list.response?.order_list ?? []).map((order) => order.order_sn);
    if (orderSns.length === 0) return [];

    const detail = await shopeeFetch<{
      response?: {
        order_list?: Array<{
          order_sn: string;
          order_status?: string;
          total_amount?: number;
          buyer_username?: string;
          recipient_address?: {
            name?: string;
            phone?: string;
            full_address?: string;
          };
          item_list?: Array<{
            item_id: number;
            model_id?: number;
            item_name?: string;
            model_quantity_purchased?: number;
            model_discounted_price?: number;
          }>;
        }>;
      };
    }>("/api/v2/order/get_order_detail", {
      account,
      query: {
        order_sn_list: orderSns.join(","),
        response_optional_fields: "item_list,recipient_address,total_amount,buyer_username",
      },
    });

    return (detail.response?.order_list ?? []).map((order) => ({
      orderSn: order.order_sn,
      status: String(order.order_status || ""),
      buyerName: order.buyer_username || null,
      recipientName: order.recipient_address?.name || null,
      recipientPhone: order.recipient_address?.phone || null,
      fullAddress: order.recipient_address?.full_address || null,
      totalAmount: Number(order.total_amount) || 0,
      items: (order.item_list ?? []).map((item) => ({
        itemId: String(item.item_id),
        modelId: item.model_id ? String(item.model_id) : null,
        itemName: item.item_name || String(item.item_id),
        quantity: Number(item.model_quantity_purchased) || 1,
        price: Number(item.model_discounted_price) || 0,
      })),
    }));
  },
};
