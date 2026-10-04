import { describe, expect, test } from "vitest";
import {
  DEFAULT_FORM_FIELDS,
  HONEYPOT_FIELD,
  buildLeadAlert,
  isLikelyBot,
  leadOrgName,
  parseAttribution,
  publicFormSchema,
  sourceFromAttribution,
  validateSubmission,
  type PublicFieldDef,
} from "./public-forms";

const fields: PublicFieldDef[] = [
  { key: "pic_name", label: "Nama", type: "text", required: true, placeholder: null, help_text: null, options: [], width: 1 },
  { key: "pic_phone", label: "WhatsApp", type: "phone", required: true, placeholder: null, help_text: null, options: [], width: 1 },
  { key: "pic_email", label: "Email", type: "email", required: false, placeholder: null, help_text: null, options: [], width: 2 },
  { key: "org_name", label: "Instansi", type: "text", required: false, placeholder: null, help_text: null, options: [], width: 2 },
  { key: "org_type", label: "Jenis", type: "select", required: false, placeholder: null, help_text: null, options: ["corporate", "sekolah"], width: 1 },
  { key: "notes", label: "Kebutuhan", type: "textarea", required: false, placeholder: null, help_text: null, options: [], width: 2 },
  { key: "jumlah_pax", label: "Jumlah Pax", type: "number", required: false, placeholder: null, help_text: null, options: [], width: 1 },
  { key: "tanggal_acara", label: "Tanggal", type: "date", required: false, placeholder: null, help_text: null, options: [], width: 1 },
  { key: "setuju", label: "Setuju dihubungi", type: "checkbox", required: false, placeholder: null, help_text: null, options: [], width: 2 },
];

describe("form publik / web-to-lead (EPIC-050 T-5.3)", () => {
  test("field bawaan memenuhi skema & punya jalur kontak", () => {
    const parsed = publicFormSchema.safeParse({
      slug: "kontak", name: "Kontak", title: "Hubungi Kami", fields: DEFAULT_FORM_FIELDS,
    });
    expect(parsed.success).toBe(true);
  });

  test("form tanpa telepon/email ditolak — lead tidak bisa dihubungi", () => {
    const parsed = publicFormSchema.safeParse({
      slug: "kosong", name: "X", title: "X",
      fields: [{ key: "org_name", label: "Instansi", type: "text" }],
    });
    expect(parsed.success).toBe(false);
  });

  test("slug harus aman untuk URL", () => {
    const base = { name: "X", title: "X", fields: DEFAULT_FORM_FIELDS };
    expect(publicFormSchema.safeParse({ ...base, slug: "Kontak Kami" }).success).toBe(false);
    expect(publicFormSchema.safeParse({ ...base, slug: "../etc" }).success).toBe(false);
    expect(publicFormSchema.safeParse({ ...base, slug: "kontak-acara" }).success).toBe(true);
  });

  test("kiriman valid: dipisah ke kolom lead dan custom", () => {
    const r = validateSubmission(fields, {
      pic_name: "  Budi  ", pic_phone: "0812-3456-7890", pic_email: "budi@maju.co.id",
      org_name: "PT Maju", org_type: "corporate", notes: "Butuh katering 100 pax",
      jumlah_pax: "100", tanggal_acara: "2026-10-01", setuju: "on",
    });
    expect(r.ok).toBe(true);
    expect(r.lead.pic_name).toBe("Budi");
    expect(r.lead.pic_phone).toBe("081234567890");
    expect(r.lead.org_name).toBe("PT Maju");
    expect(r.custom).toEqual({ jumlah_pax: 100, tanggal_acara: "2026-10-01", setuju: true });
  });

  test("kunci yang tidak terdaftar dibuang, bukan ikut tersimpan", () => {
    const r = validateSubmission(fields, {
      pic_name: "Budi", pic_phone: "08123456789",
      owner_user_id: "penyusup", company_id: "penyusup", score: 999,
    });
    expect(r.ok).toBe(true);
    expect(r.custom).toEqual({});
    expect(Object.keys(r.lead)).toEqual(["pic_name", "pic_phone"]);
  });

  test("wajib, email, telepon pendek, dan pilihan asing ditolak per field", () => {
    const r = validateSubmission(fields, { pic_email: "bukan-email", org_type: "kampus", jumlah_pax: "abc" });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.key).sort()).toEqual(["jumlah_pax", "org_type", "pic_email", "pic_name", "pic_phone"].sort());
    const short = validateSubmission(fields, { pic_name: "A", pic_phone: "0812" });
    expect(short.ok).toBe(false);
    expect(short.errors.some((e) => e.key === "pic_phone")).toBe(true);
  });

  test("tanpa telepon maupun email selalu ditolak", () => {
    const onlyName: PublicFieldDef[] = [fields[0], { ...fields[3], required: true }];
    const r = validateSubmission(onlyName, { pic_name: "Budi", org_name: "PT Maju" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.key === "pic_phone")).toBe(true);
  });

  test("honeypot terisi & kiriman terlalu cepat dianggap bot", () => {
    expect(isLikelyBot({ [HONEYPOT_FIELD]: "http://spam" }).bot).toBe(true);
    // Waktu realistis: memakai angka kecil membuat "30 jam lalu" jadi negatif
    // sehingga pemeriksaan stempel terlewat sama sekali.
    const now = Date.UTC(2026, 8, 13, 10, 0, 0);
    expect(isLikelyBot({ form_started_at: now - 1000 }, now).bot).toBe(true);
    expect(isLikelyBot({ form_started_at: now - 10_000 }, now).bot).toBe(false);
    // Stempel waktu dari masa depan = payload dipalsukan. Alasannya harus akurat,
    // bukan "terlalu cepat", karena admin membaca alasan ini di daftar kiriman.
    const future = isLikelyBot({ form_started_at: now + 60_000 }, now);
    expect(future.bot).toBe(true);
    expect(future.reason).toBe("stempel waktu tidak wajar");
    expect(isLikelyBot({ form_started_at: now - 30 * 60 * 60 * 1000 }, now).reason).toBe("stempel waktu tidak wajar");
    expect(isLikelyBot({ form_started_at: now - 1000 }, now).reason).toBe("kiriman terlalu cepat");
    expect(isLikelyBot({}).bot).toBe(false);
    expect(isLikelyBot({ [HONEYPOT_FIELD]: "   " }).bot).toBe(false);
  });

  test("UTM dibaca & dipotong panjangnya", () => {
    const a = parseAttribution({ utm_source: " Instagram ", utm_campaign: "x".repeat(400), utm_medium: "", other: "abaikan" });
    expect(a.utm_source).toBe("Instagram");
    expect(a.utm_campaign?.length).toBe(150);
    expect(a.utm_medium).toBeNull();
    expect(a.referrer).toBeNull();
  });

  test("utm_source dipetakan ke sumber lead yang sah, sisanya jatuh ke default", () => {
    const of = (src: string | null) => sourceFromAttribution(parseAttribution({ utm_source: src }), "website");
    expect(of("instagram")).toBe("instagram");
    expect(of("IG")).toBe("instagram");
    expect(of("google_ads")).toBe("google");
    expect(of("whatsapp")).toBe("wa");
    expect(of("tiktok")).toBe("website");
    expect(of(null)).toBe("website");
    expect(sourceFromAttribution(parseAttribution({ utm_source: "'; DROP TABLE --" }), "website")).toBe("website");
  });

  test("nama lead & pesan WA ke sales", () => {
    expect(leadOrgName({ org_name: "PT Maju" })).toBe("PT Maju");
    expect(leadOrgName({ pic_name: "Budi" })).toBe("Budi");
    expect(leadOrgName({})).toBe("Kiriman Form Publik");
    const msg = buildLeadAlert("Permintaan Penawaran", { org_name: "PT Maju", pic_name: "Budi", pic_phone: "08123456789", notes: "100 pax" },
      parseAttribution({ utm_source: "instagram", utm_campaign: "promo-oktober" }));
    expect(msg).toContain("Lead baru dari form publik");
    expect(msg).toContain("PT Maju");
    expect(msg).toContain("instagram / promo-oktober");
  });
});
