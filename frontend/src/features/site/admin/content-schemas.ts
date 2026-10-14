import type { ContentKey } from "../types";

/**
 * Editor layout of each content key. Mirrors the Go schemas in
 * backend/internal/modules/site/domain/content.go, with labels.
 */
export type SchemaField =
  | { name: string; label: string; kind: "text" | "long" | "url" | "strings" }
  | { name: string; label: string; kind: "object"; fields: SchemaField[] }
  | { name: string; label: string; kind: "objects"; addLabel: string; fields: { name: string; label: string; kind: "text" | "long" | "url" | "strings" }[] };

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
    description: "Jenis kelas, blok 8 minggu, Hukum NüHabit, stasiun HYROX, pelatih dan FAQ.",
    fields: [
      { name: "intro", label: "Pembuka", kind: "object", fields: [text("title", "Judul"), long("text", "Teks")] },
      {
        name: "class_types",
        label: "Jenis kelas",
        kind: "objects",
        addLabel: "Tambah kelas",
        fields: [
          { name: "name", label: "Nama", kind: "text" },
          { name: "slug", label: "Slug halaman (mis. race-sim)", kind: "text" },
          { name: "duration", label: "Durasi", kind: "text" },
          { name: "level", label: "Level", kind: "text" },
          { name: "text", label: "Teks", kind: "long" },
          { name: "focus", label: "Fokus (satu per baris)", kind: "strings" },
          { name: "image_url", label: "Foto", kind: "url" },
        ],
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
            fields: [{ name: "name", label: "Nama", kind: "text" }, { name: "weeks", label: "Minggu", kind: "text" }, { name: "text", label: "Teks", kind: "long" }, { name: "items", label: "Isi fase (satu per baris)", kind: "strings" }],
          },
        ],
      },
      { name: "laws", label: "Hukum NüHabit", kind: "object", fields: [text("title", "Judul"), { name: "items", label: "Daftar (satu per baris)", kind: "strings" }] },
      {
        name: "stations",
        label: "Stasiun HYROX",
        kind: "objects",
        addLabel: "Tambah stasiun",
        fields: [
          { name: "name", label: "Nama", kind: "text" },
          { name: "slug", label: "Slug halaman (mis. sled-push)", kind: "text" },
          { name: "spec", label: "Jarak atau repetisi", kind: "text" },
          { name: "text", label: "Teks", kind: "long" },
          { name: "tips", label: "Tips teknik (satu per baris)", kind: "strings" },
          { name: "image_url", label: "Foto", kind: "url" },
        ],
      },
      {
        name: "coaches",
        label: "Pelatih",
        kind: "objects",
        addLabel: "Tambah pelatih",
        fields: [
          { name: "name", label: "Nama (sama dengan nama pelatih di jadwal)", kind: "text" },
          { name: "slug", label: "Slug halaman (mis. maya-kusuma)", kind: "text" },
          { name: "role", label: "Peran", kind: "text" },
          { name: "bio", label: "Bio", kind: "long" },
          { name: "quote", label: "Kutipan", kind: "long" },
          { name: "specialties", label: "Keahlian (satu per baris)", kind: "strings" },
          { name: "certifications", label: "Sertifikasi (satu per baris)", kind: "strings" },
          { name: "instagram", label: "Instagram (@handle)", kind: "text" },
          { name: "image_url", label: "Foto", kind: "url" },
        ],
      },
      { name: "faq", label: "FAQ", kind: "objects", addLabel: "Tambah pertanyaan", fields: [{ name: "question", label: "Pertanyaan", kind: "text" }, { name: "answer", label: "Jawaban", kind: "long" }] },
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
