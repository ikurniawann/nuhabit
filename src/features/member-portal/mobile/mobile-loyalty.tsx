"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, CheckCircle2, Gift, ImageIcon, Lock, Sparkles } from "lucide-react";
import { badgeTarget, type BadgeMetric } from "@/lib/member-portal/badges";
import { angka, tanggal } from "../format";
import { MEMBER_KEYS, memberApi, postJson } from "./mobile-api";
import { useLocale, useT } from "./mobile-i18n";
import { EmptyCard, ErrorNote, LoadingNote, OkNote, ScreenTitle, SectionHeader } from "./mobile-ui";

/* Reward, badge, dan koleksi (artwork + wallpaper) memakai API portal yang
 * sama dengan /member/classic. XP tidak pernah berkurang: XP hanya syarat. */

interface Reward {
  id: string;
  name: string;
  reward_type: string;
  min_xp: number;
  required_tier_name: string | null;
  image_url: string | null;
  quota_period_label: string | null;
  eligible: boolean;
  reason: string | null;
  xp_needed: number;
  remaining_stock: number | null;
}

interface Redemption {
  id: string;
  redemption_number: string;
  status: string;
  requested_at: string;
  reward_name: string;
}

interface Badge {
  id: string;
  name: string;
  image_url: string | null;
  min_lifetime_xp: number;
  metric: BadgeMetric;
  threshold: number | null;
  owned: boolean;
  awarded_at: string | null;
  is_showcased: boolean;
}

interface Collectible {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary" | "limited";
  image_url: string;
  thumbnail_url: string | null;
  owned: boolean;
  equipped?: boolean;
  locked_reason: string | null;
  xp_needed: number;
}

interface CollectionData {
  entitlement: { remaining: number; interval_xp: number };
  items: Collectible[];
}

/** locked_reason evaluateCollectible untuk item yang syaratnya terpenuhi dan bisa ditukar. */
const REDEEMABLE_REASON = "Belum kamu miliki";

const REDEMPTION_STATUS: Record<string, string> = {
  pending: "Menunggu diambil",
  approved: "Disetujui",
  fulfilled: "Sudah diambil",
  cancelled: "Dibatalkan",
  rejected: "Ditolak",
};

const RARITY_LABELS: Record<Collectible["rarity"], string> = {
  limited: "Terbatas",
  legendary: "Legendaris",
  epic: "Epik",
  rare: "Langka",
  common: "Umum",
};

/* ── Reward ──────────────────────────────────────────────────────────── */

export function RewardsScreen() {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: MEMBER_KEYS.rewards,
    queryFn: () =>
      memberApi<{ member: { total_xp: number }; rewards: Reward[]; history: Redemption[] }>(
        "/api/member-portal/rewards"
      ),
  });
  const [done, setDone] = useState<string | null>(null);
  const redeem = useMutation({
    mutationFn: (rewardId: string) => postJson<Redemption>("/api/member-portal/rewards", { reward_id: rewardId }),
    onSuccess: (redemption) => {
      setDone(t("Permintaan terkirim. Tunjukkan kode {code} ke kasir.", { code: redemption.redemption_number }));
      void queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.rewards });
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <ScreenTitle hint={t("Tukar XP dengan hadiah. XP Anda tidak berkurang.")}>{t("Reward")}</ScreenTitle>
      {isLoading && <LoadingNote />}
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {done && <OkNote>{done}</OkNote>}
      {redeem.error && <ErrorNote>{redeem.error.message}</ErrorNote>}
      {data && data.rewards.length === 0 && <EmptyCard>{t("Belum ada reward yang bisa ditukar.")}</EmptyCard>}
      {data?.rewards.map((reward) => (
        <div key={reward.id} className="nh-card flex gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-nh-raised">
            {reward.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- artwork reward dari admin
              <img src={reward.image_url} alt="" className="size-full object-cover" />
            ) : (
              <Gift size={22} className="text-nh-forest" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold">{reward.name}</p>
            <p className="text-xs text-nh-muted">
              {t("Min. {n} XP", { n: angka(reward.min_xp) })}
              {reward.required_tier_name ? ` · ${t("tier {tier}", { tier: reward.required_tier_name })}` : ""}
              {reward.remaining_stock !== null ? ` · ${t("sisa {n}", { n: reward.remaining_stock })}` : ""}
            </p>
            {reward.eligible ? (
              <button
                type="button"
                className="nh-btn-brand mt-3 !px-4 !py-2 text-sm"
                disabled={redeem.isPending}
                onClick={() => {
                  setDone(null);
                  redeem.mutate(reward.id);
                }}
              >
                {redeem.isPending && redeem.variables === reward.id ? t("Memproses…") : t("Tukar")}
              </button>
            ) : (
              <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-nh-muted">
                <Lock size={12} />
                {reward.xp_needed > 0 ? t("{n} XP lagi", { n: angka(reward.xp_needed) }) : reward.reason}
              </p>
            )}
          </div>
        </div>
      ))}

      {data && data.history.length > 0 && (
        <section>
          <SectionHeader label={t("Riwayat penukaran")} />
          <div className="nh-card divide-y divide-nh-line !py-1">
            {data.history.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-bold">{row.reward_name}</span>
                  <span className="block text-xs text-nh-muted">
                    {row.redemption_number} · {tanggal(row.requested_at, locale)}
                  </span>
                </span>
                <span className="nh-chip shrink-0 bg-nh-raised">{t(REDEMPTION_STATUS[row.status] ?? row.status)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Badge ───────────────────────────────────────────────────────────── */

export function BadgesScreen() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: MEMBER_KEYS.badges,
    queryFn: () => memberApi<{ total_xp: number; badges: Badge[] }>("/api/member-portal/badges"),
  });
  const showcase = useMutation({
    mutationFn: (badge: Badge) =>
      postJson("/api/member-portal/badges", { badge_id: badge.id, showcased: !badge.is_showcased }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.badges }),
  });
  const owned = data?.badges.filter((b) => b.owned).length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <ScreenTitle hint={t("Badge terbuka otomatis saat Anda mencapai syaratnya. Pamerkan hingga 3.")}>
        {t("Badge")}
      </ScreenTitle>
      {isLoading && <LoadingNote />}
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {showcase.error && <ErrorNote>{showcase.error.message}</ErrorNote>}
      {data && (
        <p className="text-sm font-bold">
          {t("{owned} dari {total} badge terbuka", { owned, total: data.badges.length })}
        </p>
      )}
      {data && data.badges.length === 0 && <EmptyCard>{t("Belum ada badge.")}</EmptyCard>}
      <div className="grid grid-cols-3 gap-3">
        {data?.badges.map((badge) => (
          <button
            key={badge.id}
            type="button"
            disabled={!badge.owned || showcase.isPending}
            onClick={() => showcase.mutate(badge)}
            aria-pressed={badge.owned ? badge.is_showcased : undefined}
            className={`nh-card flex flex-col items-center gap-2 !p-3 text-center ${badge.owned ? "" : "opacity-50"} ${
              badge.is_showcased ? "ring-2 ring-nh-lime" : ""
            }`}
          >
            <span className="flex size-14 items-center justify-center overflow-hidden rounded-full bg-nh-raised">
              {badge.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- artwork badge dari admin
                <img src={badge.image_url} alt="" className={`size-full object-cover ${badge.owned ? "" : "grayscale"}`} />
              ) : (
                <Award size={24} className="text-nh-forest" />
              )}
            </span>
            <span className="line-clamp-2 text-xs leading-tight font-bold">{badge.name}</span>
            <span className="text-[10px] text-nh-muted">
              {badge.owned
                ? badge.is_showcased
                  ? t("Dipamerkan")
                  : t("Ketuk untuk pamerkan")
                : (({ key, vars }) => t(key, vars))(badgeTarget(badge))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Koleksi: artwork avatar + wallpaper ─────────────────────────────── */

function CollectionGrid({
  kind,
  data,
  onRedeem,
  onEquip,
  busyId,
}: {
  kind: "avatar" | "wallpaper";
  data: CollectionData;
  onRedeem: (id: string) => void;
  onEquip?: (id: string) => void;
  busyId: string | null;
}) {
  const t = useT();
  if (data.items.length === 0) return <EmptyCard>{t("Belum ada koleksi yang dirilis.")}</EmptyCard>;
  return (
    <div className="grid grid-cols-2 gap-3">
      {data.items.map((item) => (
        <div key={item.id} className="nh-card flex flex-col gap-2 !p-3">
          <span
            className={`relative block overflow-hidden rounded-2xl bg-nh-raised ${
              kind === "wallpaper" ? "aspect-[9/16]" : "aspect-square"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- artwork koleksi dari admin */}
            <img
              src={item.thumbnail_url || item.image_url}
              alt=""
              className={`size-full object-cover ${item.owned ? "" : "opacity-60 grayscale"}`}
            />
            <span className="nh-chip absolute top-2 left-2 bg-white/85 text-[10px]">{t(RARITY_LABELS[item.rarity])}</span>
          </span>
          <p className="truncate text-sm font-bold">{item.name}</p>
          {item.owned ? (
            kind === "avatar" && onEquip ? (
              item.equipped ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-nh-forest">
                  <CheckCircle2 size={13} /> {t("Terpasang")}
                </span>
              ) : (
                <button
                  type="button"
                  className="nh-btn-ghost !px-3 !py-2 text-xs"
                  disabled={busyId !== null}
                  onClick={() => onEquip(item.id)}
                >
                  {t("Pasang")}
                </button>
              )
            ) : (
              <a href={item.image_url} download className="nh-btn-ghost !px-3 !py-2 text-xs">
                {t("Unduh")}
              </a>
            )
          ) : item.locked_reason === REDEEMABLE_REASON ? (
            <button
              type="button"
              className="nh-btn-brand !px-3 !py-2 text-xs"
              disabled={busyId !== null || data.entitlement.remaining <= 0}
              onClick={() => onRedeem(item.id)}
            >
              {busyId === item.id ? t("Memproses…") : t("Tukar jatah")}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-nh-muted">
              <Lock size={12} />
              {item.xp_needed > 0 ? t("{n} XP lagi", { n: angka(item.xp_needed) }) : item.locked_reason}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function CollectionScreen() {
  const t = useT();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"avatar" | "wallpaper">("avatar");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const avatars = useQuery({
    queryKey: MEMBER_KEYS.collectibles,
    queryFn: () => memberApi<CollectionData>("/api/member-portal/collectibles"),
  });
  const wallpapers = useQuery({
    queryKey: MEMBER_KEYS.wallpapers,
    queryFn: () => memberApi<CollectionData>("/api/member-portal/wallpapers"),
    enabled: view === "wallpaper",
  });
  const action = useMutation({
    mutationFn: ({ url, body }: { id: string; url: string; body: Record<string, string> }) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw new Error(json.error || t("Permintaan gagal"));
        return (json.message as string | undefined) ?? t("Tersimpan");
      }),
    onSuccess: (text) => {
      setMessage({ ok: true, text });
      void queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.collectibles });
      void queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.wallpapers });
    },
    onError: (error) => setMessage({ ok: false, text: error.message }),
  });
  const busyId = action.isPending ? (action.variables?.id ?? null) : null;
  const current = view === "avatar" ? avatars : wallpapers;
  const run = (id: string, url: string, body: Record<string, string>) => {
    setMessage(null);
    action.mutate({ id, url, body });
  };

  return (
    <div className="flex flex-col gap-5">
      <ScreenTitle hint={t("Setiap kelipatan XP memberi satu jatah tukar artwork atau wallpaper.")}>
        {t("Koleksi")}
      </ScreenTitle>
      <div className="inline-flex self-start rounded-full bg-nh-raised p-1" role="tablist">
        {(["avatar", "wallpaper"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold ${
              view === value ? "bg-nh-ink text-white" : "text-nh-ink/60"
            }`}
          >
            {value === "avatar" ? <Sparkles size={14} /> : <ImageIcon size={14} />}
            {value === "avatar" ? t("Artwork") : t("Wallpaper")}
          </button>
        ))}
      </div>
      {current.data && (
        <p className="rounded-2xl bg-nh-lime-soft px-4 py-3 text-sm font-semibold text-nh-forest">
          {t("Sisa jatah tukar: {n}", { n: current.data.entitlement.remaining })}
          {current.data.entitlement.interval_xp > 0 &&
            ` · ${t("1 jatah tiap {n} XP", { n: angka(current.data.entitlement.interval_xp) })}`}
        </p>
      )}
      {message && (message.ok ? <OkNote>{message.text}</OkNote> : <ErrorNote>{message.text}</ErrorNote>)}
      {current.isLoading && <LoadingNote />}
      {current.error && <ErrorNote>{current.error.message}</ErrorNote>}
      {current.data && (
        <CollectionGrid
          kind={view}
          data={current.data}
          busyId={busyId}
          onRedeem={(id) =>
            view === "avatar"
              ? run(id, "/api/member-portal/collectibles/redeem", { avatar_id: id })
              : run(id, "/api/member-portal/wallpapers/redeem", { wallpaper_id: id })
          }
          onEquip={view === "avatar" ? (id) => run(id, "/api/member-portal/collectibles/equip", { avatar_id: id }) : undefined}
        />
      )}
    </div>
  );
}
