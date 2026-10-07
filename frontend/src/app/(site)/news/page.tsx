import type { Metadata } from "next";
import { NewsPage } from "@/features/site/components/news-page";
import { fetchArticles } from "@/features/site/lib/public-api";
import { ARTICLE_CATEGORIES, type ArticleCategory } from "@/features/site/types";

export const metadata: Metadata = { title: "News" };

function asCategory(value: string | string[] | undefined): ArticleCategory | null {
  const v = Array.isArray(value) ? value[0] : value;
  return (ARTICLE_CATEGORIES as readonly string[]).includes(v ?? "") ? (v as ArticleCategory) : null;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const category = asCategory((await searchParams).category);
  return <NewsPage articles={await fetchArticles(category ?? undefined)} category={category} />;
}
