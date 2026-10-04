export interface SupervisorRow {
  id: string;
  full_name: string | null;
  email: string | null;
  has_pin: boolean;
  legacy_pin: boolean;
}

export interface CandidateRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
}

export type SupervisorAction =
  | { action: "set_pin"; user_id: string; pin: string }
  | { action: "promote"; user_id: string }
  | { action: "demote"; user_id: string };

type ApiJson<T> = { success?: boolean; error?: string; data?: T };

export async function fetchSupervisors(): Promise<SupervisorRow[]> {
  const res = await fetch("/api/pos/supervisors");
  const json = (await res.json()) as ApiJson<{ supervisors?: SupervisorRow[] }>;
  if (!res.ok || !json.success) throw new Error(json.error || "Gagal memuat supervisor");
  return json.data?.supervisors ?? [];
}

/** User yang bisa dijadikan supervisor (admin tidak ikut). Galat jaringan = daftar kosong. */
export async function fetchSupervisorCandidates(search: string): Promise<CandidateRow[]> {
  try {
    const res = await fetch(`/api/pos/supervisors?candidates=1&search=${encodeURIComponent(search.trim())}`);
    const json = (await res.json()) as ApiJson<{ candidates?: CandidateRow[] }>;
    return json.data?.candidates ?? [];
  } catch {
    return [];
  }
}

export async function postSupervisorAction(body: SupervisorAction): Promise<string | undefined> {
  const res = await fetch("/api/pos/supervisors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiJson<{ message?: string }>;
  if (!res.ok || !json.success) throw new Error(json.error || "Gagal menyimpan");
  return json.data?.message;
}
