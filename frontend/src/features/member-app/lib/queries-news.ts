"use client";

import { useQuery } from "@tanstack/react-query";
import { memberApi } from "./api";

/** News member (Go /api/member-portal/app/news): berita, event, tips, promo cabang member. */
export type NewsCategory = "news" | "event" | "tips" | "promo";

export interface NewsItem {
  id: string;
  title: string;
  category: NewsCategory;
  summary: string | null;
  /** Hanya pada detail. */
  body?: string;
  image_url: string | null;
  pinned: boolean;
  published_at: string;
}

export const NEWS_CATEGORIES: NewsCategory[] = ["news", "event", "tips", "promo"];

/** Label kategori (kunci i18n Inggris). */
export const NEWS_CATEGORY_LABEL: Record<NewsCategory, string> = {
  news: "News",
  event: "Events",
  tips: "Training tips",
  promo: "Promo",
};

export const newsKeys = {
  list: (category: string) => ["member-app", "news", category] as const,
  item: (id: string) => ["member-app", "news-item", id] as const,
};

export const useNews = (category: NewsCategory | "" = "") =>
  useQuery({
    queryKey: newsKeys.list(category),
    queryFn: () => memberApi<NewsItem[]>(`/app/news${category ? `?category=${category}` : ""}`),
  });

export const useNewsItem = (id: string) =>
  useQuery({ queryKey: newsKeys.item(id), queryFn: () => memberApi<NewsItem>(`/app/news/${encodeURIComponent(id)}`) });
