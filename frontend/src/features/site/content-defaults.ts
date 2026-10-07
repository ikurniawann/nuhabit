import type { ContentByKey, ContentKey } from "./types";

/**
 * Fallback copy when the public API is unreachable. The Go module
 * (backend/internal/modules/site/domain/content.go) owns the real defaults
 * and merges stored values over them; these only keep a page rendering
 * during an outage, so they stay short.
 */
export const CONTENT_DEFAULTS: ContentByKey = {
  home: {
    hero: {
      kicker: "HYROX training gym",
      title: "Latihan yang bikin kamu kuat buat hidup, bukan cuma buat gym.",
      subtitle: "Kelas kecil, coach bersertifikat, dan program 8 minggu yang terukur.",
      video_url: "",
      image_url: "",
      cta_label: "Coba Gratis",
    },
    partners: [],
    pillars: [],
    mission: { quote: "", author: "" },
    reel: [],
  },
  training: {
    intro: { title: "Satu metode, tiga jenis kelas.", text: "" },
    class_types: [],
    block: { title: "Blok 8 minggu, 4 fase", text: "", phases: [] },
    laws: { title: "Hukum NüHabit", items: [] },
  },
  space: { title: "Ruang latihan", intro: "", sections: [] },
  brand: { title: "Cerita kami", intro: "", story_md: "", values: [], image_url: "" },
  social: { instagram: "", tiktok: "", youtube: "", whatsapp: "", email: "" },
  legal_privacy: { title: "Kebijakan Privasi", body_md: "" },
  legal_terms: { title: "Syarat & Ketentuan", body_md: "" },
  analytics: { gtm_id: "", meta_pixel_id: "" },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeDeep(base: unknown, over: unknown): unknown {
  if (isRecord(base) && isRecord(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = mergeDeep(base[k], v);
    return out;
  }
  return over === undefined ? base : over;
}

/** The stored value laid over the key's defaults, field by field. */
export function withDefaults<K extends ContentKey>(key: K, value: unknown): ContentByKey[K] {
  return mergeDeep(CONTENT_DEFAULTS[key], isRecord(value) ? value : {}) as ContentByKey[K];
}
