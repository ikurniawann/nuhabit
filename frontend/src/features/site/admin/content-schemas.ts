import type { ContentKey } from "../types";

/**
 * Editor layout of each content key. Mirrors the Go schemas in
 * backend/internal/modules/site/domain/content.go, with labels.
 */
export type SchemaField =
  | { name: string; label: string; kind: "text" | "long" | "url" | "strings" }
  | { name: string; label: string; kind: "object"; fields: SchemaField[] }
  | { name: string; label: string; kind: "objects"; addLabel: string; fields: { name: string; label: string; kind: "text" | "long" | "url" }[] };

export interface ContentSchema {
  label: string;
  description: string;
  fields: SchemaField[];
}

const text = (name: string, label: string): SchemaField => ({ name, label, kind: "text" });
const long = (name: string, label: string): SchemaField => ({ name, label, kind: "long" });
const url = (name: string, label: string): SchemaField => ({ name, label, kind: "url" });

export const CONTENT_SCHEMAS: Record<ContentKey, ContentSchema> = {
  home: {
    label: "Beranda",
    description: "Hero, partner, pilar, cerita anggota dan foto latihan. Gunakan hanya foto dan testimoni asli yang sudah diizinkan untuk tayang.",
    fields: [
      {
        name: "hero",
        label: "Hero",
        kind: "object",
        fields: [text("kicker", "Kicker"), text("title", "Judul"), long("subtitle", "Subjudul"), url("video_url", "Video (mp4)"), url("image_url", "Gambar latar"), text("cta_label", "Label tombol")],
      },
      { name: "partners", label: "Partner", kind: "objects", addLabel: "Tambah partner", fields: [{ name: "name", label: "Nama", kind: "text" }, { name: "logo_url", label: "Logo", kind: "url" }] },
      {
        name: "pillars",
        label: "Pilar",
        kind: "objects",
        addLabel: "Tambah pilar",
        fields: [{ name: "code", label: "Kode", kind: "text" }, { name: "title", label: "Judul", kind: "text" }, { name: "text", label: "Teks", kind: "long" }],
      },
      { name: "mission", label: "Misi", kind: "object", fields: [long("quote", "Kutipan"), text("author", "Penulis")] },
      { name: "reel", label: "Reel komunitas", kind: "objects", addLabel: "Tambah foto", fields: [{ name: "image_url", label: "Foto", kind: "url" }, { name: "caption", label: "Keterangan", kind: "text" }] },
      { name: "stories", label: "Cerita anggota terverifikasi", kind: "objects", addLabel: "Tambah cerita", fields: [{ name: "name", label: "Nama yang disetujui", kind: "text" }, { name: "role", label: "Keterangan anggota", kind: "text" }, { name: "quote", label: "Kutipan asli", kind: "long" }, { name: "outcome", label: "Hasil atau tonggak nyata (opsional)", kind: "text" }, { name: "image_url", label: "Foto berizin (opsional)", kind: "url" }] },
    ],
  },
  training: {
    label: "Training",
    description: "Jenis kelas, blok 8 minggu dan Hukum NüHabit.",
    fields: [
      { name: "intro", label: "Pembuka", kind: "object", fields: [text("title", "Judul"), long("text", "Teks")] },
      {
        name: "class_types",
        label: "Jenis kelas",
        kind: "objects",
        addLabel: "Tambah kelas",
        fields: [{ name: "name", label: "Nama", kind: "text" }, { name: "duration", label: "Durasi", kind: "text" }, { name: "text", label: "Teks", kind: "long" }],
      },
      {
        name: "block",
        label: "Blok 8 minggu",
        kind: "object",
        fields: [
          text("title", "Judul"),
          long("text", "Teks"),
          {
            name: "phases",
            label: "Fase",
            kind: "objects",
            addLabel: "Tambah fase",
            fields: [{ name: "name", label: "Nama", kind: "text" }, { name: "weeks", label: "Minggu", kind: "text" }, { name: "text", label: "Teks", kind: "long" }],
          },
        ],
      },
      { name: "laws", label: "Hukum NüHabit", kind: "object", fields: [text("title", "Judul"), { name: "items", label: "Daftar (satu per baris)", kind: "strings" }] },
    ],
  },
  space: {
    label: "Ruang Latihan",
    description: "Judul, pengantar dan bagian bergambar.",
    fields: [
      text("title", "Judul"),
      long("intro", "Pengantar"),
      { name: "sections", label: "Bagian", kind: "objects", addLabel: "Tambah bagian", fields: [{ name: "title", label: "Judul", kind: "text" }, { name: "text", label: "Teks", kind: "long" }, { name: "image_url", label: "Gambar", kind: "url" }] },
    ],
  },
  brand: {
    label: "Cerita Kami",
    description: "Cerita merek dalam markdown dan nilai-nilai.",
    fields: [
      text("title", "Judul"),
      long("intro", "Pengantar"),
      long("story_md", "Cerita (markdown)"),
      { name: "values", label: "Nilai", kind: "objects", addLabel: "Tambah nilai", fields: [{ name: "title", label: "Judul", kind: "text" }, { name: "text", label: "Teks", kind: "long" }] },
      url("image_url", "Gambar"),
    ],
  },
  social: {
    label: "Sosial",
    description: "Tautan media sosial di footer.",
    fields: [text("instagram", "Instagram (URL)"), text("tiktok", "TikTok (URL)"), text("youtube", "YouTube (URL)"), text("whatsapp", "WhatsApp (nomor)"), text("email", "Email")],
  },
  legal_privacy: { label: "Kebijakan Privasi", description: "Halaman /privacy.", fields: [text("title", "Judul"), long("body_md", "Isi (markdown)")] },
  legal_terms: { label: "Syarat & Ketentuan", description: "Halaman /terms.", fields: [text("title", "Judul"), long("body_md", "Isi (markdown)")] },
  analytics: {
    label: "Analytics",
    description: "Dipasang di layout situs saat terisi.",
    fields: [text("gtm_id", "Google Tag Manager ID (GTM-…)"), text("meta_pixel_id", "Meta Pixel ID")],
  },
};

export const CONTENT_KEYS = Object.keys(CONTENT_SCHEMAS) as ContentKey[];
