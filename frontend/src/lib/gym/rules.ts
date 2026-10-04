/**
 * Aturan bisnis gym (port BusinessRules NüHabit). Disimpan sebagai
 * konfigurasi di gym.business_rules: baris global (branch_id NULL) +
 * override per cabang yang hanya berisi kunci yang berbeda.
 *
 * Fungsi di sini pure kecuali getGymRules, yang hanya memakai client
 * yang diberikan pemanggil (tidak membuka koneksi sendiri).
 */
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

export type ForfeitPolicy = "forfeit" | "free";

export interface GymRules {
  /** Masa berlaku default kredit bonus/penyesuaian (hari). */
  creditExpiryDays: number;
  /** Batal lebih dekat dari ini (jam sebelum mulai) = batal terlambat. */
  cancellationDeadlineHours: number;
  lateCancelPolicy: ForfeitPolicy;
  noShowPolicy: ForfeitPolicy;
  /** Keluar-masuk lagi dalam jendela ini tidak dihitung kunjungan baru (menit). */
  reEntryGraceMin: number;
  /** QR yang sama tidak bisa dipakai masuk lagi dalam jendela ini (menit). */
  antiPassbackMin: number;
  /** Umur QR check-in member (detik). */
  qrTtlSec: number;
  waitlistAutoPromote: boolean;
  /** Saldo kredit di bawah/sama dengan ini = saldo menipis. */
  lowBalanceThreshold: number;
  /** Ingatkan member saat kredit akan kedaluwarsa dalam N hari. */
  expiryReminderDays: number;
  bookingOpensDaysBefore: number;
  bookingClosesMinBefore: number;
}

export type GymRuleKey = keyof GymRules;

export const GYM_RULE_DEFAULTS: GymRules = {
  creditExpiryDays: 60,
  cancellationDeadlineHours: 4,
  lateCancelPolicy: "forfeit",
  noShowPolicy: "forfeit",
  reEntryGraceMin: 15,
  antiPassbackMin: 60,
  qrTtlSec: 45,
  waitlistAutoPromote: true,
  lowBalanceThreshold: 3,
  expiryReminderDays: 7,
  bookingOpensDaysBefore: 7,
  bookingClosesMinBefore: 0,
};

const int = (min: number, max: number, label: string) =>
  z
    .number({ error: `${label} harus berupa angka` })
    .int(`${label} harus bilangan bulat`)
    .min(min, `${label} minimal ${min}`)
    .max(max, `${label} maksimal ${max}`);

const policy = z.enum(["forfeit", "free"], { error: "Kebijakan harus forfeit atau free" });

/** Batas nilai mengikuti CHECK constraint di skema referensi NüHabit. */
const rulesShape = {
  creditExpiryDays: int(1, 3650, "Masa berlaku kredit"),
  cancellationDeadlineHours: int(0, 720, "Batas batal"),
  lateCancelPolicy: policy,
  noShowPolicy: policy,
  reEntryGraceMin: int(0, 1440, "Grace masuk ulang"),
  antiPassbackMin: int(0, 1440, "Anti-passback"),
  qrTtlSec: int(10, 3600, "Umur QR"),
  waitlistAutoPromote: z.boolean({ error: "Promosi waitlist harus ya/tidak" }),
  lowBalanceThreshold: int(0, 1000, "Ambang saldo menipis"),
  expiryReminderDays: int(1, 365, "Pengingat kedaluwarsa"),
  bookingOpensDaysBefore: int(0, 365, "Booking dibuka"),
  bookingClosesMinBefore: int(0, 10080, "Booking ditutup"),
} satisfies Record<GymRuleKey, z.ZodType>;

const fullSchema = z.object(rulesShape).strict();
const patchSchema = z.object(rulesShape).partial().strict();

export const GYM_RULE_KEYS = Object.keys(GYM_RULE_DEFAULTS) as GymRuleKey[];

export type RulesValidation<T> = { ok: true; rules: T } | { ok: false; error: string };

function toValidation<T>(result: { success: true; data: T } | { success: false; error: z.ZodError }): RulesValidation<T> {
  if (result.success) return { ok: true, rules: result.data };
  const issue = result.error.issues[0];
  const key = issue?.path[0];
  if (issue?.code === "unrecognized_keys") return { ok: false, error: `Kunci aturan tidak dikenal: ${issue.keys.join(", ")}` };
  return { ok: false, error: `${typeof key === "string" ? `${key}: ` : ""}${issue?.message ?? "Aturan tidak valid"}` };
}

/** Validasi aturan global lengkap (semua kunci wajib). */
export function validateGymRules(input: unknown): RulesValidation<GymRules> {
  return toValidation(fullSchema.safeParse(input));
}

/** Validasi override cabang / patch: hanya kunci yang dikirim, tiap nilai dicek. */
export function validateGymRulesPatch(input: unknown): RulesValidation<Partial<GymRules>> {
  return toValidation(patchSchema.safeParse(input));
}

/**
 * Ambil hanya kunci yang dikenal dan bernilai valid dari JSON tersimpan.
 * Data lama/korup tidak boleh menjatuhkan booking: kunci buruk diabaikan.
 */
export function sanitizeStoredRules(raw: unknown): Partial<GymRules> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<GymRules> = {};
  for (const key of GYM_RULE_KEYS) {
    const parsed = rulesShape[key].safeParse((raw as Record<string, unknown>)[key]);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

/** Default ← global ← override cabang. */
export function resolveGymRules(globalRaw: unknown, branchRaw?: unknown): GymRules {
  return { ...GYM_RULE_DEFAULTS, ...sanitizeStoredRules(globalRaw), ...sanitizeStoredRules(branchRaw) };
}

/** Aturan efektif untuk cabang (atau global bila branchId kosong). */
export async function getGymRules(client: Pool | PoolClient, branchId?: string | null): Promise<GymRules> {
  const { rows } = await client.query<{ branch_id: string | null; rules: unknown }>(
    `SELECT branch_id, rules FROM gym.business_rules
      WHERE branch_id IS NULL OR branch_id = $1`,
    [branchId ?? null]
  );
  const global = rows.find((r) => r.branch_id === null)?.rules;
  const branch = branchId ? rows.find((r) => r.branch_id === branchId)?.rules : undefined;
  return resolveGymRules(global, branch);
}
