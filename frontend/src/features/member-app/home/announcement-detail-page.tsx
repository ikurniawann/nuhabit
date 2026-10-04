"use client";

import { ArrowLeft, Megaphone } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useT } from "../lib/i18n";
import { useAnnouncement } from "../lib/queries-home";
import { EmptyState, Spinner, formatDayTime } from "../ui";

export function AnnouncementDetailPage() {
  const t = useT();
  const { announcementId = "" } = useParams<{ announcementId: string }>();
  const router = useRouter();
  const { data: a, isLoading, isError } = useAnnouncement(announcementId);

  const back = (
    <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
      <ArrowLeft size={16} /> {t("Back")}
    </button>
  );

  if (isError) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <EmptyState title={t("Announcement not found")} />
      </div>
    );
  }
  if (isLoading || !a) return <Spinner label={t("Loading announcement…")} />;

  return (
    <div className="flex flex-col gap-5">
      {back}

      {a.imageUrl ? (
        <div className="nh-card relative overflow-hidden !border-0 !p-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.imageUrl} alt="" className="h-52 w-full object-cover" />
        </div>
      ) : (
        <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
          <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
          <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
            <Megaphone size={22} className="text-nh-lime" />
          </span>
        </div>
      )}

      <div>
        <p className="text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">
          {t("Announcement")} · {formatDayTime(a.createdAt)}
        </p>
        <h1 className="nh-display mt-1 text-3xl leading-tight">{a.title}</h1>
      </div>

      <p className="text-[15px] leading-relaxed text-nh-ink/80">{a.message}</p>

      {a.deepLink ? (
        <Link href={a.deepLink} className="nh-btn-brand">
          {t("Open in the app")}
        </Link>
      ) : null}
    </div>
  );
}
