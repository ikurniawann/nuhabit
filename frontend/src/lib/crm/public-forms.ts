/**
 * EPIC-050 Fase 5 (T-5.3) — form publik (web-to-lead), bagian murni.
 *
 * Endpoint publik tidak punya sesi login, jadi seluruh isian divalidasi di sini
 * terhadap definisi form yang tersimpan. Field yang tidak terdaftar dibuang.
 */
import { z } from "zod";
import { LEAD_SOURCES } from "@/lib/sales-funnel/lead-sources";

export const PUBLIC_FIELD_TYPES = ["text", "textarea", "email", "phone", "number", "date", "select", "checkbox"] as const;
export type PublicFieldType = (typeof PUBLIC_FIELD_TYPES)[number];

export const PUBLIC_FIELD_TYPE_LABELS: Record<PublicFieldType, string> = {
  text: "Teks singkat",
  textarea: "Teks panjang",
  email: "Email",
  phone: "Nomor telepon",
  number: "Angka",
  date: "Tanggal",
  select: "Pilihan",
  checkbox: "Centang",
};

/**
 * Field yang dipetakan langsung ke kolom lead. Sisanya masuk ke `custom` jsonb,
 * sehingga custom field CRM (Fase 3) bisa dipakai di form tanpa kode baru.
 */
export const LEAD_MAPPED_KEYS = ["org_name", "pic_name", "pic_phone", "pic_email", "city", "notes", "org_type"] as const;
export type LeadMappedKey = (typeof LEAD_MAPPED_KEYS)[number];

export const LEAD_MAPPED_LABELS: Record<LeadMappedKey, string> = {
  org_name: "Nama instansi / perusahaan",
  pic_name: "Nama Anda",
  pic_phone: "Nomor WhatsApp",
  pic_email: "Email",
  city: "Kota",
  notes: "Kebutuhan Anda",
  org_type: "Jenis instansi",
};

export const publicFieldSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "key: huruf kecil, angka, underscore; diawali huruf"),
  label: z.string().trim().min(1).max(120),
  type: z.enum(PUBLIC_FIELD_TYPES),
  required: z.boolean().default(false),
  placeholder: z.string().trim().max(120).optional().nullable(),
  help_text: z.string().trim().max(200).optional().nullable(),
  options: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  /** Lebar di grid form: 1 = setengah, 2 = penuh. */
  width: z.number().int().min(1).max(2).default(2),
});
export type PublicFieldDef = z.infer<typeof publicFieldSchema>;

export const publicFormSchema = z
  .object({
    slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,49}$/, "slug: huruf kecil, angka, tanda hubung"),
    name: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(150),
    description: z.string().trim().max(600).optional().nullable(),
    fields: z.array(publicFieldSchema).min(1).max(25),
    submit_label: z.string().trim().min(1).max(40).default("Kirim"),
    success_message: z.string().trim().min(1).max(500).default("Terima kasih! Tim kami akan menghubungi Anda."),
    redirect_url: z.string().url().max(500).optional().nullable(),
    /** Lead baru diberi sumber ini bila form tidak membawa UTM. */
    default_source: z.enum(LEAD_SOURCES).default("website"),
    notify_user_ids: z.array(z.string().uuid()).max(20).default([]),
    notify_numbers: z.array(z.string().trim().min(8).max(20)).max(10).default([]),
    is_active: z.boolean().default(true),
  })
  .refine((f) => f.fields.some((x) => x.key === "pic_phone" || x.key === "pic_email"), {
    message: "Form wajib punya field pic_phone atau pic_email agar lead bisa dihubungi",
    path: ["fields"],
  });
export type PublicFormInput = z.infer<typeof publicFormSchema>;

/** Definisi form default saat halaman /public dibuat pertama kali. */
export const DEFAULT_FORM_FIELDS: PublicFieldDef[] = [
  { key: "pic_name", label: "Nama Anda", type: "text", required: true, placeholder: "cth. Budi Santoso", help_text: null, options: [], width: 1 },
  { key: "pic_phone", label: "Nomor WhatsApp", type: "phone", required: true, placeholder: "cth. 08123456789", help_text: "Kami menghubungi lewat WhatsApp.", options: [], width: 1 },
  { key: "org_name", label: "Nama instansi / perusahaan", type: "text", required: true, placeholder: "cth. PT Maju Bersama", help_text: null, options: [], width: 2 },
  { key: "org_type", label: "Jenis instansi", type: "select", required: false, placeholder: null, help_text: null, width: 1,
    options: ["corporate", "sekolah", "komunitas", "travel-agent", "pemerintah", "perorangan", "lainnya"] },
  { key: "city", label: "Kota", type: "text", required: false, placeholder: "cth. Bandung", help_text: null, options: [], width: 1 },
  { key: "pic_email", label: "Email", type: "email", required: false, placeholder: "nama@perusahaan.com", help_text: null, options: [], width: 2 },
  { key: "notes", label: "Kebutuhan Anda", type: "textarea", required: true, placeholder: "Ceritakan acara atau kebutuhan latihan tim Anda", help_text: null, options: [], width: 2 },
];

// ── UTM / atribusi ─────────────────────────────────────────────────────────
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

export const UTM_LABELS: Record<UtmKey, string> = {
  utm_source: "Sumber (utm_source)",
  utm_medium: "Media (utm_medium)",
  utm_campaign: "Kampanye (utm_campaign)",
  utm_content: "Konten (utm_content)",
  utm_term: "Kata kunci (utm_term)",
};

/**
 * UTM dari URL halaman saat ini plus halaman masuk dan referrer, dibaca di
 * titik kirim (bukan lewat efek). Kosong di server.
 */
export function readPageAttribution(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const sp = new URLSearchParams(window.location.search);
  const found: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = sp.get(k);
    if (v) found[k] = v;
  }
  found.landing_page = window.location.href.slice(0, 500);
  if (document.referrer) found.referrer = document.referrer.slice(0, 500);
  return found;
}

export interface Attribution {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_page: string | null;
  referrer: string | null;
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s.length > 0 ? s : null;
};

/** Ambil UTM dari payload/query. Nilai dipotong agar tidak dipakai menitipkan data besar. */
export function parseAttribution(raw: Record<string, unknown> | null | undefined): Attribution {
  const r = raw ?? {};
  return {
    utm_source: clean(r.utm_source, 100),
    utm_medium: clean(r.utm_medium, 100),
    utm_campaign: clean(r.utm_campaign, 150),
    utm_content: clean(r.utm_content, 150),
    utm_term: clean(r.utm_term, 150),
    landing_page: clean(r.landing_page, 500),
    referrer: clean(r.referrer, 500),
  };
}

export type LeadSource = (typeof LEAD_SOURCES)[number];

/** A valid lead source, or "lainnya" for anything crm_sales_leads rejects. */
export function toLeadSource(value: string | null | undefined): LeadSource {
  return (LEAD_SOURCES as readonly string[]).includes(value ?? "") ? (value as LeadSource) : "lainnya";
}

/**
 * Sumber lead dari UTM. utm_source bebas diisi siapa pun, jadi dipetakan ke
 * daftar sumber yang sah (crm_sales_leads_source_check); yang tak dikenal
 * jatuh ke default form, dan default yang tidak sah menjadi "lainnya".
 * Lalu lintas web (website, web, organic) menjadi "website".
 */
export function sourceFromAttribution(a: Attribution, fallback: string): LeadSource {
  const known: Record<string, string> = {
    instagram: "instagram", ig: "instagram", facebook: "instagram", meta: "instagram",
    google: "google", googleads: "google", google_ads: "google", adwords: "google", sem: "google",
    wa: "wa", whatsapp: "wa",
    referral: "referral", refferal: "referral",
    pameran: "pameran", event: "pameran", expo: "pameran",
    website: "website", web: "website", organic: "website",
  };
  const key = (a.utm_source ?? "").toLowerCase().replace(/[^a-z_]/g, "");
  return toLeadSource(known[key] ?? fallback);
}

// ── validasi kiriman ───────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SubmissionResult {
  ok: boolean;
  errors: Array<{ key: string; message: string }>;
  /** Nilai untuk kolom lead. */
  lead: Partial<Record<LeadMappedKey, string>>;
  /** Sisanya, untuk kolom `custom` jsonb. */
  custom: Record<string, unknown>;
}

/**
 * Validasi kiriman terhadap definisi form. Kunci yang tidak ada di definisi
 * dibuang, jadi klien tidak bisa menitipkan kolom lain.
 */
export function validateSubmission(fields: PublicFieldDef[], payload: Record<string, unknown> | null | undefined): SubmissionResult {
  const input = payload ?? {};
  const errors: SubmissionResult["errors"] = [];
  const lead: SubmissionResult["lead"] = {};
  const custom: Record<string, unknown> = {};
  const mapped = new Set<string>(LEAD_MAPPED_KEYS);

  for (const f of fields) {
    const raw = input[f.key];
    const empty = raw === undefined || raw === null || raw === "" || raw === false;
    if (empty) {
      if (f.required) errors.push({ key: f.key, message: `${f.label} wajib diisi` });
      continue;
    }
    let value: string | number | boolean;
    switch (f.type) {
      case "email": {
        const s = String(raw).trim().slice(0, 150);
        if (!EMAIL_RE.test(s)) { errors.push({ key: f.key, message: `${f.label} bukan email yang valid` }); continue; }
        value = s;
        break;
      }
      case "phone": {
        const digits = String(raw).replace(/[^0-9+]/g, "");
        if (digits.replace(/\D/g, "").length < 8) { errors.push({ key: f.key, message: `${f.label} terlalu pendek` }); continue; }
        value = digits.slice(0, 20);
        break;
      }
      case "number": {
        // Tanpa cek string kosong, "abc" tersaring jadi "" lalu Number("") = 0
        // dan isian omong kosong diterima diam-diam.
        const digits = String(raw).replace(/[^0-9.-]/g, "");
        const n = Number(digits);
        if (digits === "" || !Number.isFinite(n)) { errors.push({ key: f.key, message: `${f.label} harus angka` }); continue; }
        value = n;
        break;
      }
      case "date": {
        const s = String(raw).trim();
        if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) { errors.push({ key: f.key, message: `${f.label} harus tanggal` }); continue; }
        value = s;
        break;
      }
      case "select": {
        const s = String(raw).trim();
        if (f.options.length > 0 && !f.options.includes(s)) { errors.push({ key: f.key, message: `${f.label} bukan pilihan yang tersedia` }); continue; }
        value = s;
        break;
      }
      case "checkbox":
        value = raw === true || raw === "true" || raw === "on" || raw === 1 || raw === "1";
        break;
      case "textarea":
        value = String(raw).trim().slice(0, 2000);
        break;
      default:
        value = String(raw).trim().slice(0, 200);
    }
    if (mapped.has(f.key)) lead[f.key as LeadMappedKey] = String(value);
    else custom[f.key] = value;
  }

  const contactAlreadyFlagged = errors.some((e) => e.key === "pic_phone" || e.key === "pic_email");
  if (!lead.pic_phone && !lead.pic_email && !contactAlreadyFlagged) {
    errors.push({ key: "pic_phone", message: "Isi nomor WhatsApp atau email agar kami bisa menghubungi Anda" });
  }
  return { ok: errors.length === 0, errors, lead, custom };
}

/**
 * Jebakan bot: field tersembunyi yang harus tetap kosong, dan kiriman yang
 * terlalu cepat (manusia butuh waktu mengetik).
 */
export const HONEYPOT_FIELD = "website_url";
export const MIN_FILL_SECONDS = 3;

export function isLikelyBot(payload: Record<string, unknown> | null | undefined, now: number = Date.now()): { bot: boolean; reason?: string } {
  const p = payload ?? {};
  const trap = p[HONEYPOT_FIELD];
  if (typeof trap === "string" && trap.trim() !== "") return { bot: true, reason: "honeypot terisi" };
  const started = Number(p.form_started_at);
  if (Number.isFinite(started) && started > 0) {
    const elapsed = (now - started) / 1000;
    // Urutan penting: stempel dari masa depan juga memenuhi `elapsed < MIN_FILL_SECONDS`,
    // jadi bila dicek belakangan alasannya salah dilaporkan sebagai "terlalu cepat".
    if (elapsed < 0 || elapsed > 24 * 3600) return { bot: true, reason: "stempel waktu tidak wajar" };
    if (elapsed < MIN_FILL_SECONDS) return { bot: true, reason: "kiriman terlalu cepat" };
  }
  return { bot: false };
}

/** Nama lead saat form tidak meminta nama instansi. */
export function leadOrgName(lead: SubmissionResult["lead"]): string {
  return lead.org_name?.trim() || lead.pic_name?.trim() || "Kiriman Form Publik";
}

/** Pesan WA ke sales saat lead masuk dari form publik. */
export function buildLeadAlert(formName: string, lead: SubmissionResult["lead"], attribution: Attribution): string {
  const lines = [
    "🌐 *Lead baru dari form publik*",
    `Form: ${formName}`,
    `Instansi: ${leadOrgName(lead)}`,
    `PIC: ${lead.pic_name ?? "—"}${lead.pic_phone ? ` · ${lead.pic_phone}` : ""}`,
  ];
  if (lead.pic_email) lines.push(`Email: ${lead.pic_email}`);
  if (lead.city) lines.push(`Kota: ${lead.city}`);
  if (lead.notes) lines.push("", `Kebutuhan: ${lead.notes.slice(0, 300)}`);
  const utm = [attribution.utm_source, attribution.utm_medium, attribution.utm_campaign].filter(Boolean);
  if (utm.length > 0) lines.push("", `Asal: ${utm.join(" / ")}`);
  return lines.join("\n");
}
