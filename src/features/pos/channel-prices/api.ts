import type { ChannelRule } from "@/lib/pos/channel-pricing";

export type ChannelPriceProduct = {
  id: string;
  name: string;
  sku: string | null;
  category_name: string | null;
  base_price: number;
  is_available: boolean | null;
  variant_count: number;
  modifier_count: number;
  override_price: number | null;
};

export type ChannelPricesData = {
  channels: ChannelRule[];
  channel: ChannelRule | null;
  products: ChannelPriceProduct[];
};

export type ChannelRulePayload = {
  markup_percent: number;
  rounding_step: number;
  rounding_mode: string;
  is_active: boolean;
};

async function parseJson<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: T };
  if (!res.ok || json.success === false) throw new Error(json.error || `Permintaan gagal (${res.status})`);
  return json.data as T;
}

export async function fetchChannelPrices(channel: string | null): Promise<ChannelPricesData> {
  const qs = channel ? `?channel=${encodeURIComponent(channel)}` : "";
  const res = await fetch(`/api/pos/channel-prices${qs}`, { credentials: "include", cache: "no-store" });
  return parseJson<ChannelPricesData>(res);
}

export async function saveChannelRule(code: string, payload: ChannelRulePayload): Promise<ChannelRule> {
  const res = await fetch(`/api/pos/sales-channels/${encodeURIComponent(code)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<ChannelRule>(res);
}

export async function saveChannelPrices(
  channel: string,
  body: { prices: Array<{ product_id: string; price: number | null }> } | { reset_all: true }
): Promise<{ saved: number; cleared: number }> {
  const res = await fetch("/api/pos/channel-prices", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, ...body }),
  });
  return parseJson<{ saved: number; cleared: number }>(res);
}
