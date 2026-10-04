import { z } from "zod";

/**
 * Validasi env server saat boot (dipanggil dari src/instrumentation.ts).
 * Wajib: koneksi Postgres; tanpanya server berhenti dengan pesan jelas.
 * Opsional: integrasi yang hanya dikonfigurasi lewat env dan mati bila
 * env-nya kosong; dicatat sekali sebagai satu peringatan. Integrasi yang
 * juga bisa diisi dari Settings (WhatsApp gateway, OpenAI, Google, Instagram)
 * tidak diperiksa di sini.
 * Daftar lengkap variabel: .env.example di root repo.
 */

type Env = Record<string, string | undefined>;

/** URL Postgres untuk semua pool: DATABASE_URL, cadangan MIGRATE_DATABASE_URL. */
export function databaseUrl(env: Env = process.env): string {
  return env.DATABASE_URL?.trim() || env.MIGRATE_DATABASE_URL?.trim() || "";
}

const requiredSchema = z.object({
  databaseUrl: z
    .string()
    .regex(/^postgres(ql)?:\/\/\S+$/, "DATABASE_URL (atau MIGRATE_DATABASE_URL) wajib berisi URL postgres://..."),
});

const has = (env: Env, key: string) => Boolean(env[key]?.trim());

const OPTIONAL_INTEGRATIONS: Array<{ label: string; enabled: (env: Env) => boolean }> = [
  {
    label: "URL publik NEXT_PUBLIC_APP_URL (tautan di WA/email dari job latar jadi relatif)",
    enabled: (env) => has(env, "NEXT_PUBLIC_APP_URL") || has(env, "NEXT_PUBLIC_BASE_URL"),
  },
  { label: "email Resend (RESEND_API_KEY)", enabled: (env) => has(env, "RESEND_API_KEY") },
  {
    label: "pembayaran Xendit (XENDIT_SECRET_KEY + XENDIT_WEBHOOK_TOKEN)",
    enabled: (env) =>
      env.XENDIT_MOCK === "1" || (has(env, "XENDIT_SECRET_KEY") && has(env, "XENDIT_WEBHOOK_TOKEN")),
  },
  {
    label: "web push portal member (VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY)",
    enabled: (env) => has(env, "VAPID_PUBLIC_KEY") && has(env, "VAPID_PRIVATE_KEY"),
  },
];

/** Integrasi opsional yang mati karena env-nya kosong. */
export function disabledIntegrations(env: Env = process.env): string[] {
  return OPTIONAL_INTEGRATIONS.filter((item) => !item.enabled(env)).map((item) => item.label);
}

/** Lempar Error bila env wajib tidak valid; selain itu log satu peringatan untuk integrasi yang mati. */
export function assertServerEnv(env: Env = process.env): void {
  const parsed = requiredSchema.safeParse({ databaseUrl: databaseUrl(env) });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `- ${issue.message}`).join("\n");
    throw new Error(`Konfigurasi env server tidak valid (lihat .env.example):\n${issues}`);
  }
  const disabled = disabledIntegrations(env);
  if (disabled.length > 0) {
    console.warn(`[env] Integrasi opsional nonaktif karena env kosong:\n- ${disabled.join("\n- ")}`);
  }
}
