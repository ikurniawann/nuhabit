/** Shapes served by the Go site module (/api/public/site, /api/site). */

export interface HomeContent {
  hero: { kicker: string; title: string; subtitle: string; video_url: string; image_url: string; cta_label: string };
  partners: { name: string; logo_url: string }[];
  pillars: { code: string; title: string; text: string }[];
  mission: { quote: string; author: string };
  reel: { image_url: string; caption: string }[];
}

export interface TrainingContent {
  intro: { title: string; text: string };
  class_types: { name: string; duration: string; text: string }[];
  block: { title: string; text: string; phases: { name: string; weeks: string; text: string }[] };
  laws: { title: string; items: string[] };
}

export interface SpaceContent {
  title: string;
  intro: string;
  sections: { title: string; text: string; image_url: string }[];
}

export interface BrandContent {
  title: string;
  intro: string;
  story_md: string;
  values: { title: string; text: string }[];
  image_url: string;
}

export interface SocialContent {
  instagram: string;
  tiktok: string;
  youtube: string;
  whatsapp: string;
  email: string;
}

export interface LegalContent {
  title: string;
  body_md: string;
}

export interface AnalyticsContent {
  gtm_id: string;
  meta_pixel_id: string;
}

export interface ContentByKey {
  home: HomeContent;
  training: TrainingContent;
  space: SpaceContent;
  brand: BrandContent;
  social: SocialContent;
  legal_privacy: LegalContent;
  legal_terms: LegalContent;
  analytics: AnalyticsContent;
}

export type ContentKey = keyof ContentByKey;

export interface BranchSummary {
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  instagram: string | null;
  hero_image_url: string | null;
}

export interface BranchProfile extends BranchSummary {
  email: string | null;
  directions: string | null;
  benefits: { title: string; text: string }[];
  accordions: { facilities: string[]; parking: string[]; team: string[]; community: string[] };
  extras: { name: string; blurb: string }[];
  testimonials: { name: string; quote: string; role: string }[];
}

export const ARTICLE_CATEGORIES = ["training", "events", "apparel", "news"] as const;
export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ArticleCategory, string> = {
  training: "Training",
  events: "Event",
  apparel: "Apparel",
  news: "Berita",
};

export type PublishStatus = "draft" | "published";

export interface Article {
  id: string;
  slug: string;
  title: string;
  category: ArticleCategory;
  excerpt: string | null;
  cover_image_url: string | null;
  body_md: string;
  status: PublishStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteEvent {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  cover_image_url: string | null;
  body_md: string;
  form_slug: string | null;
  status: PublishStatus;
  created_at: string;
  updated_at: string;
}
