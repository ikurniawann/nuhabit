import type { SaveXpRulePayload, XpRule, XpRulesListParams } from "./types";
import { parseCrmResponse } from "../http";

export type * from "./types";

export async function listXpRules(params: XpRulesListParams): Promise<XpRule[]> {
  const search = new URLSearchParams();
  if (params.source_channel) search.set("source_channel", params.source_channel);
  const response = await fetch(`/api/crm/xp-rules?${search.toString()}`, { cache: "no-store" });
  const json = await parseCrmResponse<{ data: XpRule[] }>(response, "Gagal memuat aturan XP");
  return json.data ?? [];
}

export async function saveXpRule(payload: SaveXpRulePayload): Promise<XpRule> {
  const response = await fetch("/api/crm/xp-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseCrmResponse<{ data: XpRule }>(response, "Gagal menyimpan aturan XP");
  return json.data;
}
