"use client";

import { useCallback, useEffect, useState } from "react";
import { Crown, Flame, Lock, Trophy } from "lucide-react";
import { memberFetch, rupiah } from "../lib";
import { Card, CenterSpinner, SectionTitle, Tag } from "../ui";

interface TierInfo {
  id: string;
  code: string;
  name: string;
  min_lifetime_xp: number;
  discount_percent: number;
  display_color: string | null;
  benefits: { early_booking_days: number; cancel_window_hours: number | null; waitlist_priority: boolean };
}

export interface Progress {
  status: string;
  frozen: boolean;
  lifetime_xp: number;
  xp_balance: number;
  tier: TierInfo | null;
  next: { tier: TierInfo; xp_needed: number } | null;
  tiers: TierInfo[];
  streak: { this_week: number; min_sessions: number; weeks: number };
  total_sessions: number;
  earn_rules: { code: string; name: string; xp_mode: string; xp_value: number; amount_step: number; metadata: Record<string, unknown> }[];
  history: { id: string; direction: string; source_type: string | null; xp_delta: number; description: string | null; created_at: string }[];
}

interface Board {
  entries: { rank: number; alias: string; sessions: number; tier_name: string | null; me: boolean }[];
  me: { opted_in: boolean; sessions: number; rank: number | null };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Nama aktivitas XP & label riwayat dalam bahasa Inggris (data aturan di DB berbahasa Indonesia untuk backoffice). */
const RULE_NAME: Record<string, string> = {
  studio_class_attended: "Attend a class",
  studio_pt_attended: "Attend Personal Training",
  studio_offpeak: "Off-peak class bonus",
  studio_weekly_streak: "Weekly streak",
  studio_streak_4w: "4-week streak",
  studio_pass_purchase: "Buy a pass",
  studio_early_renewal: "Renew before your pass runs out",
};
const HISTORY_LABEL: Record<string, string> = {
  class_attended: "Class attended",
  pt_attended: "Personal Training attended",
  offpeak_attended: "Off-peak bonus",
  weekly_streak: "Weekly streak bonus",
  streak_4w: "4-week streak bonus",
  pass_purchase: "Pass purchase",
  early_renewal: "Early renewal bonus",
};

/** Daftar benefit tier dalam kalimat member. */
export function benefitLines(t: TierInfo): string[] {
  const out: string[] = [];
  if (t.benefits.early_booking_days > 0) out.push(`Book classes ${t.benefits.early_booking_days} ${t.benefits.early_booking_days === 1 ? "day" : "days"} earlier`);
  if (t.benefits.waitlist_priority) out.push("Priority on the waitlist");
  if (t.benefits.cancel_window_hours !== null) out.push(`Free cancellation up to ${t.benefits.cancel_window_hours} hours before`);
  if (t.discount_percent > 0) out.push(`${t.discount_percent}% off F&B`);
  return out.length ? out : ["Access to classes & Personal Training with your pass"];
}

function ruleLabel(r: Progress["earn_rules"][number]): string {
  if (r.xp_mode === "per_amount") return `${fmt(r.xp_value)} XP / ${rupiah(r.amount_step)}`;
  return `+${fmt(r.xp_value)} XP`;
}

function ruleHint(r: Progress["earn_rules"][number]): string | null {
  if (r.code === "studio_weekly_streak") return `${Number(r.metadata?.min_sessions) || 3}+ sessions in a week`;
  if (r.code === "studio_offpeak" && r.metadata?.start) return `Classes starting ${String(r.metadata.start)}–${String(r.metadata.end)}`;
  return null;
}

export function ProgressSection() {
  const [p, setP] = useState<Progress | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const load = useCallback(async () => {
    const [pr, lb] = await Promise.allSettled([
      memberFetch<{ data: Progress }>("/api/member-portal/studio/progress"),
      memberFetch<{ data: Board }>("/api/member-portal/studio/leaderboard"),
    ]);
    if (pr.status === "fulfilled") setP(pr.value.data);
    if (lb.status === "fulfilled") setBoard(lb.value.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleBoard() {
    if (!board) return;
    setBusy(true);
    try {
      await memberFetch("/api/member-portal/studio/prefs", { method: "PUT", body: { leaderboard_opt_in: !board.me.opted_in } });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!p) return <CenterSpinner />;
  const tier = p.tier;
  const pct = p.next ? Math.min(100, Math.round(((p.lifetime_xp - (tier?.min_lifetime_xp ?? 0)) / Math.max(p.next.tier.min_lifetime_xp - (tier?.min_lifetime_xp ?? 0), 1)) * 100)) : 100;

  return (
    <div className="space-y-7">
      {/* Kartu tier */}
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-nh-forest via-nh-everglade to-nh-forest p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-nh-beige/60">Your tier</p>
            <p className="mt-1 flex items-center gap-2 font-display text-4xl font-bold uppercase" style={{ color: tier?.display_color ?? undefined }}>
              <Crown className="size-7" /> {tier?.name ?? "Starter"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-nh-beige/60">XP balance</p>
            <p className="font-display text-2xl font-bold tabular-nums text-nh-lime">{fmt(p.xp_balance)}</p>
          </div>
        </div>
        {p.frozen ? (
          <p className="mt-4 flex items-start gap-2 rounded-2xl bg-black/25 px-3 py-2 text-sm text-nh-lemon">
            <Lock className="mt-0.5 size-4 shrink-0" /> Your tier benefits and XP are on hold. Please contact the front desk for details.
          </p>
        ) : (
          <>
            <div className="mt-5 flex items-baseline justify-between text-sm">
              <span className="text-nh-beige/70">{fmt(p.lifetime_xp)} XP total</span>
              <span className="text-nh-beige/70">{p.next ? `${fmt(p.next.xp_needed)} XP to ${p.next.tier.name}` : "Top tier"}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/30">
              <div className="h-full rounded-full bg-nh-lime transition-all" style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
        {tier && !p.frozen && (
          <ul className="mt-5 space-y-1.5 text-sm text-nh-beige/85">
            {benefitLines(tier).map((b) => (
              <li key={b}>✓ {b}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Streak */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-1.5 font-semibold">
              <Flame className="size-4 text-nh-lime" /> {p.streak.weeks > 0 ? `${p.streak.weeks}-week streak` : "Weekly streak"}
            </p>
            <p className="mt-0.5 text-xs text-nh-beige/60">
              {p.streak.this_week >= p.streak.min_sessions
                ? "Weekly goal reached. Keep it going."
                : `${p.streak.min_sessions - p.streak.this_week} more ${p.streak.min_sessions - p.streak.this_week === 1 ? "session" : "sessions"} this week for the streak bonus.`}
            </p>
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: p.streak.min_sessions }, (_, i) => (
              <span key={i} className={`size-3 rounded-full ${i < p.streak.this_week ? "bg-nh-lime" : "bg-white/15"}`} />
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-nh-beige/50">{fmt(p.total_sessions)} {p.total_sessions === 1 ? "session" : "sessions"} attended since you joined.</p>
      </Card>

      {/* Leaderboard */}
      <section>
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Trophy className="size-5 text-nh-lime" /> This month's leaderboard
          </span>
        </SectionTitle>
        <p className="-mt-1 mb-3 text-xs text-nh-beige/55">Ranked by sessions attended — consistency, not speed.</p>
        {!board ? (
          <CenterSpinner />
        ) : (
          <>
            {board.entries.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/15 px-4 py-6 text-center text-sm text-nh-beige/60">No one on the board yet this month. Be the first.</p>
            ) : (
              <ol className="space-y-1.5">
                {board.entries.map((e, i) => (
                  <li key={`${e.alias}-${i}`} className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 ${e.me ? "bg-nh-lime/15 ring-1 ring-nh-lime/40" : "bg-nh-jungle"}`}>
                    <span className={`w-6 font-display text-lg font-bold tabular-nums ${e.rank <= 3 ? "text-nh-lime" : "text-nh-beige/60"}`}>{e.rank}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {e.alias}
                      {e.me && <span className="ml-1 text-xs font-normal text-nh-lime">(you)</span>}
                    </span>
                    {e.tier_name && <Tag>{e.tier_name}</Tag>}
                    <span className="w-24 shrink-0 whitespace-nowrap text-right text-sm tabular-nums text-nh-beige/80">{e.sessions} {e.sessions === 1 ? "session" : "sessions"}</span>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-3">
              <p className="text-sm text-nh-beige/80">
                {board.me.opted_in ? `You're #${board.me.rank ?? "-"} · ${board.me.sessions} ${board.me.sessions === 1 ? "session" : "sessions"}` : `You're hidden · ${board.me.sessions} ${board.me.sessions === 1 ? "session" : "sessions"} this month`}
              </p>
              <button type="button" disabled={busy} onClick={toggleBoard} className="shrink-0 text-xs font-semibold text-nh-lime disabled:opacity-50">
                {board.me.opted_in ? "Hide me" : "Show me"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Tier ladder & how to earn XP */}
      <section>
        <SectionTitle
          action={
            <button type="button" onClick={() => setShowRules((v) => !v)} className="text-xs font-semibold text-nh-lime">
              {showRules ? "Close" : "How to earn XP"}
            </button>
          }
        >
          Tier ladder
        </SectionTitle>
        {showRules && (
          <Card className="mb-3">
            <ul className="space-y-2.5">
              {p.earn_rules.map((r) => (
                <li key={r.code} className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    {RULE_NAME[r.code] ?? r.name}
                    {ruleHint(r) && <span className="block text-xs text-nh-beige/50">{ruleHint(r)}</span>}
                  </span>
                  <span className="shrink-0 font-semibold text-nh-lime">{ruleLabel(r)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="space-y-2">
          {p.tiers.map((t) => {
            const reached = p.lifetime_xp >= t.min_lifetime_xp;
            const current = tier?.id === t.id;
            return (
              <div key={t.id} className={`rounded-2xl border px-4 py-3 ${current ? "border-nh-lime/50 bg-nh-lime/5" : "border-white/10"}`}>
                <div className="flex items-center justify-between">
                  <p className="font-display font-semibold" style={{ color: reached ? t.display_color ?? undefined : undefined }}>
                    {t.name} {current && <span className="ml-1 text-xs font-normal text-nh-lime">· your tier</span>}
                  </p>
                  <span className="text-xs text-nh-beige/55">{t.min_lifetime_xp === 0 ? "Start" : `${fmt(t.min_lifetime_xp)} XP`}</span>
                </div>
                <p className="mt-1 text-xs text-nh-beige/60">{benefitLines(t).join(" · ")}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Riwayat XP */}
      {p.history.length > 0 && (
        <section>
          <SectionTitle>XP history</SectionTitle>
          <ul className="space-y-1.5">
            {p.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 rounded-2xl bg-nh-jungle px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{(h.source_type && HISTORY_LABEL[h.source_type]) ?? (h.direction === "spend" ? "XP redeemed" : "XP adjustment")}</span>
                  <span className="text-[11px] text-nh-beige/45">{new Date(h.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })}</span>
                </span>
                <span className={`shrink-0 font-display font-semibold tabular-nums ${h.xp_delta >= 0 ? "text-nh-lime" : "text-nh-beige/70"}`}>
                  {h.xp_delta >= 0 ? "+" : ""}
                  {fmt(h.xp_delta)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
