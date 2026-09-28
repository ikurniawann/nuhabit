import type { CrmSettings, CrmTierConfig, CrmXpRuleConfig, PosProductXp } from "./types";

export type * from "./types";

async function parseCrmResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || fallbackError);
  }
  return json as T;
}

export async function getCrmSettings(): Promise<CrmSettings> {
  const response = await fetch("/api/crm/settings", { cache: "no-store" });
  const json = await parseCrmResponse<{ data: Partial<CrmSettings> }>(
    response,
    "Gagal memuat konfigurasi CRM"
  );
  const d = json.data;
  return {
    ark_coin_enabled: d.ark_coin_enabled !== false,
    xp_enabled: d.xp_enabled !== false,
    topup_bonus_percent: Number(d.topup_bonus_percent ?? 0),
    profile_completion_free_xp: Number(d.profile_completion_free_xp ?? 0),
    cs_sla_response_minutes: Number(d.cs_sla_response_minutes ?? 15),
    cs_sla_resolution_minutes: Number(d.cs_sla_resolution_minutes ?? 1440),
    cs_business_hours_start: Number(d.cs_business_hours_start ?? 10),
    cs_business_hours_end: Number(d.cs_business_hours_end ?? 22),
    cs_auto_reply_enabled: d.cs_auto_reply_enabled !== false,
    cs_auto_reply_text: String(d.cs_auto_reply_text ?? ""),
    cs_csat_enabled: d.cs_csat_enabled !== false,
    cs_csat_text: String(d.cs_csat_text ?? ""),
  };
}

export async function updateCrmSettings(payload: Partial<CrmSettings>): Promise<void> {
  const response = await fetch("/api/crm/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parseCrmResponse(response, "Gagal menyimpan konfigurasi CRM");
}

export async function listCrmTiers(): Promise<CrmTierConfig[]> {
  const response = await fetch("/api/crm/tiers", { cache: "no-store" });
  const json = await parseCrmResponse<{ data: CrmTierConfig[] }>(
    response,
    "Gagal memuat tier"
  );
  return json.data ?? [];
}

export async function saveCrmTier(payload: CrmTierConfig): Promise<void> {
  const response = await fetch("/api/crm/tiers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: payload.code,
      name: payload.name,
      rank: Number(payload.rank) || 0,
      min_lifetime_xp: Math.max(0, Math.floor(Number(payload.min_lifetime_xp) || 0)),
      min_total_spend: Math.max(0, Number(payload.min_total_spend) || 0),
      xp_multiplier: Math.max(0, Number(payload.xp_multiplier) || 1),
      discount_percent: Math.min(100, Math.max(0, Number(payload.discount_percent) || 0)),
      display_color: payload.display_color || "#6B7280",
      is_active: payload.is_active,
    }),
  });
  await parseCrmResponse(response, "Gagal menyimpan tier");
}

export async function listPosProductXp(): Promise<PosProductXp[]> {
  const response = await fetch("/api/pos/products", { cache: "no-store" });
  const json = await parseCrmResponse<{ data: Array<PosProductXp & { xp_points?: number }> }>(
    response,
    "Gagal memuat produk POS"
  );
  return (json.data ?? []).map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    base_price: Number(product.base_price) || 0,
    xp: Number(product.xp ?? product.xp_points) || 0,
    category: product.category ?? null,
  }));
}

export async function updateProductXp(productId: string, xp: number): Promise<void> {
  const response = await fetch(`/api/pos/products/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xp_points: Math.max(0, Math.floor(xp)) }),
  });
  await parseCrmResponse(response, "Gagal menyimpan XP produk");
}

export async function listCrmXpRules(): Promise<CrmXpRuleConfig[]> {
  const response = await fetch("/api/crm/xp-rules?source_channel=pos", { cache: "no-store" });
  const json = await parseCrmResponse<{ data: CrmXpRuleConfig[] }>(
    response,
    "Gagal memuat XP rules"
  );
  return json.data ?? [];
}

export async function saveCrmXpRule(payload: CrmXpRuleConfig): Promise<void> {
  const response = await fetch("/api/crm/xp-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: payload.code,
      name: payload.name,
      source_channel: payload.source_channel || "pos",
      source_type: payload.source_type,
      source_id: payload.source_id ?? null,
      outlet_scope: payload.outlet_scope ?? "all",
      outlet_id: payload.outlet_id ?? null,
      xp_mode: payload.xp_mode,
      xp_value: Math.max(0, Number(payload.xp_value) || 0),
      amount_step: Math.max(1, Number(payload.amount_step) || 1),
      min_amount: Math.max(0, Number(payload.min_amount) || 0),
      max_xp_per_event: payload.max_xp_per_event == null
        ? null
        : Math.max(0, Math.floor(Number(payload.max_xp_per_event) || 0)),
      tier_multiplier_enabled: payload.tier_multiplier_enabled,
      priority: Math.floor(Number(payload.priority) || 100),
      is_active: payload.is_active,
    }),
  });
  await parseCrmResponse(response, "Gagal menyimpan XP rule");
}
