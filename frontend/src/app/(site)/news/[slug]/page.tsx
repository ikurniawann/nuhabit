import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticlePage } from "@/features/site/components/news-page";
import { fetchArticle } from "@/features/site/lib/public-api";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await fetchArticle((await params).slug);
  return { title: article?.title ?? "Article", description: article?.excerpt ?? undefined };
}

export default async function Page({ params }: Props) {
  const article = await fetchArticle((await params).slug);
  if (!article) notFound();
  return <ArticlePage article={article} />;
}
