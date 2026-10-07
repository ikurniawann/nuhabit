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
      title: "Training that makes you strong for life, not only for the gym.",
      subtitle: "Small classes, certified coaches and a measurable 8-week program.",
      video_url: "",
      image_url: "",
      cta_label: "Start a Trial",
    },
    partners: [],
    pillars: [],
    mission: { quote: "", author: "" },
    reel: [],
    stories: [],
  },
  training: {
    intro: { title: "One method, three class types.", text: "" },
    class_types: [],
    block: { title: "An 8-week block in 4 phases", text: "", phases: [] },
    laws: { title: "The NüHabit Laws", items: [] },
  },
  space: { title: "The Space", intro: "", sections: [] },
  brand: { title: "Our story", intro: "", story_md: "", values: [], image_url: "" },
  social: { instagram: "", tiktok: "", youtube: "", whatsapp: "", email: "" },
  legal_privacy: { title: "Privacy Policy", body_md: "" },
  legal_terms: { title: "Terms & Conditions", body_md: "" },
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
