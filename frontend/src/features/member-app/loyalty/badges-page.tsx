"use client";

import { Award } from "lucide-react";
import { useState } from "react";
import { badgeTarget } from "@/lib/member-portal/badges";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { loyaltyKeys, setBadgeShowcased, useBadges, useRefresh, type Badge } from "../lib/queries-loyalty";
import { EmptyState, Spinner } from "../ui";
import { Notice, PageTitle } from "./loyalty-ui";

/** Badge terbuka otomatis saat syaratnya tercapai; member memamerkan hingga 3. */
export function BadgesPage() {
  const t = useT();
  const refresh = useRefresh();
  const { data, isLoading, error: loadError } = useBadges();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owned = data?.badges.filter((b) => b.owned).length ?? 0;

  const toggle = async (badge: Badge) => {
    setBusy(true);
    setError("");
    try {
      await setBadgeShowcased(badge.id, !badge.is_showcased);
      await refresh(loyaltyKeys.badges);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Request failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Badges unlock on their own when you hit the goal. Show off up to 3.")}>
        {t("Badges")}
      </PageTitle>
      {isLoading ? <Spinner label={t("Loading badges…")} /> : null}
      {loadError ? <Notice ok={false}>{loadError.message}</Notice> : null}
      {error ? <Notice ok={false}>{error}</Notice> : null}
      {data ? (
        <p className="text-sm font-bold">
          {t("{owned} of {total} badges unlocked", { owned, total: data.badges.length })}
        </p>
      ) : null}
      {data && data.badges.length === 0 ? <EmptyState title={t("No badges yet")} /> : null}
      <div className="grid grid-cols-3 gap-3">
        {data?.badges.map((badge) => {
          const target = badgeTarget(badge);
          return (
            <button
              key={badge.id}
              type="button"
              disabled={!badge.owned || busy}
              onClick={() => void toggle(badge)}
              aria-pressed={badge.owned ? badge.is_showcased : undefined}
              className={`nh-card flex flex-col items-center gap-2 !p-3 text-center ${badge.owned ? "" : "opacity-50"} ${
                badge.is_showcased ? "ring-2 ring-nh-lime" : ""
              }`}
            >
              <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-nh-raised">
                {badge.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={badge.image_url}
                    alt=""
                    className={`h-full w-full object-cover ${badge.owned ? "" : "grayscale"}`}
                  />
                ) : (
                  <Award size={24} className="text-nh-forest" />
                )}
              </span>
              <span className="line-clamp-2 text-xs leading-tight font-bold">{badge.name}</span>
              <span className="text-[10px] text-nh-muted">
                {badge.owned
                  ? badge.is_showcased
                    ? t("Showcased")
                    : t("Tap to showcase")
                  : t(target.key, target.vars)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
