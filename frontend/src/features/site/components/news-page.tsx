import Link from "next/link";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ARTICLE_CATEGORIES, CATEGORY_LABELS, type Article, type ArticleCategory } from "../types";
import { Markdown } from "../lib/markdown";
import { Container, EmptyNote, Picture, Section, SectionHeading } from "./site-section";

function CategoryChips({ active }: { active: ArticleCategory | null }) {
  const chips: { value: ArticleCategory | null; label: string }[] = [
    { value: null, label: "Semua" },
    ...ARTICLE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
  ];
  return (
    <nav aria-label="Kategori" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      {chips.map((chip) => {
        const selected = chip.value === active;
        return (
          <Link
            key={chip.label}
            href={chip.value ? `/news?category=${chip.value}` : "/news"}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors",
              selected ? "bg-ink text-on-ink" : "bg-card text-body shadow-card hover:bg-surface-2",
            )}
          >
            {chip.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ArticleCard({ article }: { article: Article }) {
  return (
    <Link href={`/news/${article.slug}`} className="group block">
      <article className="h-full overflow-hidden rounded-card bg-card shadow-card transition-shadow group-hover:shadow-float">
        <Picture src={article.cover_image_url} alt="" className="aspect-[16/10] w-full" />
        <div className="space-y-2 p-5">
          <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-accent">
            {CATEGORY_LABELS[article.category]}
            {article.published_at ? <span className="ml-2 font-normal text-muted-foreground normal-case">{formatDate(article.published_at)}</span> : null}
          </p>
          <h2 className="font-display text-lg font-semibold text-balance">{article.title}</h2>
          {article.excerpt ? <p className="line-clamp-3 text-sm text-body">{article.excerpt}</p> : null}
        </div>
      </article>
    </Link>
  );
}

export function NewsPage({ articles, category }: { articles: Article[]; category: ArticleCategory | null }) {
  return (
    <Section>
      <Container className="space-y-8">
        <SectionHeading as="h1" kicker="Berita" title="Cerita, event dan rilis terbaru" />
        <CategoryChips active={category} />
        {articles.length === 0 ? (
          <EmptyNote>Belum ada artikel{category ? ` di kategori ${CATEGORY_LABELS[category]}` : ""}.</EmptyNote>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>
        )}
      </Container>
    </Section>
  );
}

export function ArticlePage({ article }: { article: Article }) {
  return (
    <article>
      <Section className="pb-6">
        <Container className="max-w-3xl space-y-4">
          <Link href={`/news?category=${article.category}`} className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-accent">
            {CATEGORY_LABELS[article.category]}
          </Link>
          <h1 className="font-display text-3xl font-bold tracking-tight text-balance md:text-5xl">{article.title}</h1>
          {article.published_at ? <p className="text-sm text-muted-foreground">{formatDate(article.published_at)}</p> : null}
          {article.excerpt ? <p className="text-lg text-body">{article.excerpt}</p> : null}
        </Container>
      </Section>
      {article.cover_image_url ? (
        <Container className="max-w-4xl">
          <Picture src={article.cover_image_url} alt="" className="aspect-[16/9] w-full rounded-card" />
        </Container>
      ) : null}
      <Section className="pt-2">
        <Container className="max-w-3xl">
          <Markdown source={article.body_md} className="prose-site" />
        </Container>
      </Section>
    </article>
  );
}
