"use client";

import { Pin } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageTitle } from "../loyalty/loyalty-ui";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { NEWS_CATEGORIES, NEWS_CATEGORY_LABEL, useNews, type NewsCategory } from "../lib/queries-news";
import { EmptyState, Spinner, chipClass, formatDay } from "../ui";
import { NewsCover } from "./news-ui";

/** Tab News: filter kategori dan daftar news cabang member, yang disematkan dulu. */
export function NewsPage() {
  const t = useT();
  const [category, setCategory] = useState<NewsCategory | "">("");
  const { data: items, isLoading } = useNews(category);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Events, training tips and what's new at your gym.")}>{t("News")}</PageTitle>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button type="button" className={chipClass(category === "")} onClick={() => setCategory("")}>
          {t("All")}
        </button>
        {NEWS_CATEGORIES.map((c) => (
          <button key={c} type="button" className={chipClass(category === c)} onClick={() => setCategory(c)}>
            {t(NEWS_CATEGORY_LABEL[c])}
          </button>
        ))}
      </div>
      {isLoading ? <Spinner label={t("Loading news…")} /> : null}
      {items && items.length === 0 ? <EmptyState title={t("Nothing here yet.")} hint={t("Check back soon.")} /> : null}
      {items && items.length > 0 ? (
        <div className="nh-card divide-y divide-nh-line !py-1">
          {items.map((n) => (
            <Link key={n.id} href={m(`/news/${n.id}`)} className="flex gap-3.5 py-3.5">
              <NewsCover item={n} className="h-20 w-20 shrink-0 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">
                  {n.pinned ? <Pin size={12} className="text-nh-forest" aria-label={t("Pinned")} /> : null}
                  {t(NEWS_CATEGORY_LABEL[n.category])} · {formatDay(n.published_at)}
                </p>
                <p className="mt-1 line-clamp-2 text-[15px] leading-snug font-extrabold">{n.title}</p>
                {n.summary ? <p className="mt-0.5 line-clamp-2 text-sm text-nh-muted">{n.summary}</p> : null}
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
