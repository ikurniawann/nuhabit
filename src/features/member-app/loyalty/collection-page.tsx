"use client";

import { CheckCircle2, ImageIcon, Lock, Sparkles } from "lucide-react";
import { useState } from "react";
import { formatNumber } from "@/lib/format";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import {
  equipAvatar,
  loyaltyKeys,
  redeemCollectible,
  useCollection,
  useRefresh,
  type Collectible,
  type CollectionKind,
} from "../lib/queries-loyalty";
import { EmptyState, Spinner } from "../ui";
import { Notice, PageTitle } from "./loyalty-ui";

/** locked_reason evaluateCollectible untuk item yang syaratnya terpenuhi dan bisa ditukar. */
const REDEEMABLE_REASON = "Belum kamu miliki";

const RARITY_LABELS: Record<Collectible["rarity"], string> = {
  limited: "Limited",
  legendary: "Legendary",
  epic: "Epic",
  rare: "Rare",
  common: "Common",
};

/** Artwork avatar dan wallpaper: tiap kelipatan XP memberi satu jatah tukar. */
export function CollectionPage() {
  const t = useT();
  const refresh = useRefresh();
  const [kind, setKind] = useState<CollectionKind>("avatar");
  const { data, isLoading, error: loadError } = useCollection(kind);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (id: string, action: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: done });
      await refresh(loyaltyKeys.collection("avatar"), loyaltyKeys.collection("wallpaper"));
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : t("Request failed") });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Every XP milestone gives you one redeem for an artwork or wallpaper.")}>
        {t("Collection")}
      </PageTitle>

      <div className="inline-flex self-start rounded-full bg-nh-raised p-1" role="tablist">
        {(["avatar", "wallpaper"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => {
              setKind(value);
              setMessage(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold ${
              kind === value ? "bg-nh-ink text-white" : "text-nh-ink/60"
            }`}
          >
            {value === "avatar" ? <Sparkles size={14} /> : <ImageIcon size={14} />}
            {value === "avatar" ? t("Artwork") : t("Wallpaper")}
          </button>
        ))}
      </div>

      {data ? (
        <p className="rounded-2xl bg-nh-lime-soft px-4 py-3 text-sm font-semibold text-nh-forest">
          {t("Redeems left: {n}", { n: data.entitlement.remaining })}
          {data.entitlement.interval_xp > 0
            ? ` · ${t("1 redeem every {n} XP", { n: formatNumber(data.entitlement.interval_xp) })}`
            : ""}
        </p>
      ) : null}
      {message ? <Notice ok={message.ok}>{message.text}</Notice> : null}
      {isLoading ? <Spinner label={t("Loading collection…")} /> : null}
      {loadError ? <Notice ok={false}>{loadError.message}</Notice> : null}
      {data && data.items.length === 0 ? <EmptyState title={t("Nothing released yet")} /> : null}

      {data && data.items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {data.items.map((item) => (
            <div key={item.id} className="nh-card flex flex-col gap-2 !p-3">
              <span
                className={`relative block overflow-hidden rounded-2xl bg-nh-raised ${
                  kind === "wallpaper" ? "aspect-[9/16]" : "aspect-square"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnail_url || item.image_url}
                  alt=""
                  className={`h-full w-full object-cover ${item.owned ? "" : "opacity-60 grayscale"}`}
                />
                <span className="nh-chip absolute top-2 left-2 bg-white/85 text-[10px]">
                  {t(RARITY_LABELS[item.rarity])}
                </span>
              </span>
              <p className="truncate text-sm font-bold">{item.name}</p>
              {item.owned ? (
                kind === "avatar" ? (
                  item.equipped ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-nh-forest">
                      <CheckCircle2 size={13} /> {t("Equipped")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="nh-btn-ghost !px-3 !py-2 text-xs"
                      disabled={busyId !== null}
                      onClick={() => void run(item.id, () => equipAvatar(item.id), t("Artwork equipped."))}
                    >
                      {t("Equip")}
                    </button>
                  )
                ) : (
                  <a href={item.image_url} download className="nh-btn-ghost !px-3 !py-2 text-xs">
                    {t("Download")}
                  </a>
                )
              ) : item.locked_reason === REDEEMABLE_REASON ? (
                <button
                  type="button"
                  className="nh-btn-brand !px-3 !py-2 text-xs"
                  disabled={busyId !== null || data.entitlement.remaining <= 0}
                  onClick={() =>
                    void run(
                      item.id,
                      () => redeemCollectible(kind, item.id),
                      kind === "avatar" ? t("Artwork redeemed!") : t("Wallpaper redeemed!"),
                    )
                  }
                >
                  {busyId === item.id ? t("Processing…") : t("Use a redeem")}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-nh-muted">
                  <Lock size={12} />
                  {item.xp_needed > 0 ? t("{n} XP to go", { n: formatNumber(item.xp_needed) }) : item.locked_reason}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
