/** Panggil API portal member; galat server diteruskan sebagai Error berpesan. */
export async function memberApi<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body && !isForm ? { "Content-Type": "application/json" } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Permintaan gagal");
  return json.data as T;
}

export const postJson = <T>(url: string, body: unknown, method = "POST") =>
  memberApi<T>(url, { method, body: JSON.stringify(body) });

export const MEMBER_KEYS = {
  notifications: ["member-portal", "notifications"],
  events: ["member-portal", "events"],
  challenges: ["member-portal", "challenges"],
  promos: ["member-portal", "promos"],
  rewards: ["member-portal", "rewards"],
  badges: ["member-portal", "badges"],
  collectibles: ["member-portal", "collectibles"],
  wallpapers: ["member-portal", "wallpapers"],
} as const;
