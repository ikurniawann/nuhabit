import type { PosLoyaltySettings, UpdateLoyaltySettingsPayload } from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { success?: boolean; error?: string; message?: string };
  if (!res.ok || (json as { success?: boolean }).success === false) {
    throw new Error(
      (json as { error?: string; message?: string }).error ||
        (json as { message?: string }).message ||
        `Request failed (${res.status})`
    );
  }
  return json;
}

export async function fetchLoyaltySettings(): Promise<PosLoyaltySettings> {
  const res = await fetch("/api/pos/loyalty-settings", { credentials: "include", cache: "no-store" });
  const json = await parseJson<{ data: PosLoyaltySettings }>(res);
  return json.data;
}

export async function updateLoyaltySettings(
  payload: UpdateLoyaltySettingsPayload
): Promise<PosLoyaltySettings> {
  const res = await fetch("/api/pos/loyalty-settings", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson<{ data: PosLoyaltySettings }>(res);
  return json.data;
}
