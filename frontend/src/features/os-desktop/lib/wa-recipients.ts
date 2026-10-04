import { normalizeWaRecipient } from "@/lib/wa/notifications-config";

/** Tambah nomor WA ke daftar: normalisasi, tolak duplikat, dan batasi jumlah. */
export function addWaRecipient(
  list: string[],
  input: string,
  max: number
): { ok: true; list: string[] } | { ok: false; error: string } {
  const normalized = normalizeWaRecipient(input);
  if (!normalized) return { ok: false, error: "Nomor tidak valid — pakai format 08… atau 62…" };
  if (list.includes(normalized)) return { ok: false, error: "Nomor sudah terdaftar" };
  if (list.length >= max) return { ok: false, error: `Maksimal ${max} nomor` };
  return { ok: true, list: [...list, normalized] };
}

/** Angka dari input bebas ("1.500.000" → 1500000); di luar rentang → fallback. */
export function parseBoundedInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw.replace(/\D/g, ""));
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
