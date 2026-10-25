"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { SectionHeader } from "../loyalty/loyalty-ui";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { NEWS_CATEGORY_LABEL, useNews } from "../lib/queries-news";
import { NewsCover } from "./news-ui";

/** News di beranda: rel kartu foto, lima teratas (yang disematkan dulu). */
export function NewsSection() {
  const t = useT();
  const { data: items } = useNews();
  if (!items || items.length === 0) return null;

  return (
    <section>
      <SectionHeader
        label={t("NüHabit news")}
        action={
          <Link href={m("/news")} className="text-xs font-bold text-nh-muted">
            {t("All news")} →
          </Link>
        }
      />
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
        {items.slice(0, 5).map((n) => (
          <Link
            key={n.id}
            href={m(`/news/${n.id}`)}
            className="nh-card relative aspect-[4/5] w-[72%] max-w-72 shrink-0 snap-start overflow-hidden !border-0 !p-0 text-white"
          >
            <NewsCover item={n} className="absolute inset-0 h-full w-full" />
            <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
            <span className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4">
              <span
                className={`nh-chip w-fit ${n.category === "promo" ? "bg-nh-lime text-nh-forest" : "bg-white/15 text-white"}`}
              >
                {t(NEWS_CATEGORY_LABEL[n.category])}
              </span>
              <span className="nh-display line-clamp-3 text-2xl leading-[1.05]">{n.title}</span>
              {n.summary ? <span className="line-clamp-2 text-xs text-white/70">{n.summary}</span> : null}
              <span className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-white/80">
                {t("Read more")} <ChevronRight size={14} />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
