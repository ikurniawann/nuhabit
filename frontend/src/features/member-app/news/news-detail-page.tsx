"use client";

import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useT } from "../lib/i18n";
import { NEWS_CATEGORY_LABEL, useNewsItem } from "../lib/queries-news";
import { EmptyState, Spinner, formatDay } from "../ui";
import { NewsCover } from "./news-ui";

/** Detail news: sampul, kategori, ringkasan, dan isi lengkap. */
export function NewsDetailPage() {
  const t = useT();
  const { newsId = "" } = useParams<{ newsId: string }>();
  const router = useRouter();
  const { data: n, isLoading, isError } = useNewsItem(newsId);

  const back = (
    <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
      <ArrowLeft size={16} /> {t("Back")}
    </button>
  );

  if (isError) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <EmptyState title={t("News not found")} />
      </div>
    );
  }
  if (isLoading || !n) return <Spinner label={t("Loading news…")} />;

  return (
    <article className="flex flex-col gap-5">
      {back}
      <div className="nh-card relative overflow-hidden !border-0 !p-0">
        <NewsCover item={n} className="h-56 w-full" />
      </div>
      <div>
        <p className="text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">
          {t(NEWS_CATEGORY_LABEL[n.category])} · {formatDay(n.published_at)}
        </p>
        <h1 className="nh-display mt-1 text-3xl leading-tight">{n.title}</h1>
      </div>
      {n.summary ? <p className="text-[15px] leading-relaxed font-semibold">{n.summary}</p> : null}
      {n.body ? <p className="text-[15px] leading-relaxed whitespace-pre-line text-nh-ink/80">{n.body}</p> : null}
    </article>
  );
}
