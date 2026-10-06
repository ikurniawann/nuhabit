"use client";

import { useCallback, useEffect, useState } from "react";
import { Crown, Flame, Lock, Trophy } from "lucide-react";
import { memberFetch, rupiah } from "../lib";
import { Accordion, CenterSpinner, Eyebrow, SectionTitle, SideLabel, Tag } from "../ui";

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
  const plural = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;

  return (
    <div className="space-y-10">
      {/* Tier — blok dengan label vertikal */}
      <div className="flex border border-white/15">
        <SideLabel tone="lime">Your tier</SideLabel>
        <div className="min-w-0 flex-1 p-5">
          <p className="flex items-center gap-2 font-display text-5xl font-bold uppercase leading-none tracking-[-0.03em] text-white">
            <Crown className="size-8 shrink-0" style={{ color: tier?.display_color ?? undefined }} strokeWidth={1.5} /> {tier?.name ?? "Starter"}
          </p>
          <div className="mt-5 grid grid-cols-2 border-y border-white/12">
            <div className="py-3">
              <Eyebrow>XP balance</Eyebrow>
              <p className="mt-1 font-display text-3xl font-bold leading-none tabular-nums text-nh-lime">{fmt(p.xp_balance)}</p>
            </div>
            <div className="border-l border-white/12 py-3 pl-4">
              <Eyebrow>Lifetime XP</Eyebrow>
              <p className="mt-1 font-display text-3xl font-bold leading-none tabular-nums text-white">{fmt(p.lifetime_xp)}</p>
            </div>
          </div>
          {p.frozen ? (
            <p className="mt-5 flex items-start gap-2 border-l-2 border-nh-ochre bg-nh-ochre/10 px-3 py-2 text-sm text-nh-lemon">
              <Lock className="mt-0.5 size-4 shrink-0" /> Your tier benefits and XP are on hold. Please contact the front desk for details.
            </p>
          ) : (
            <>
              <div className="mt-5 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.1em] text-nh-beige/70">
                <span>{tier?.name ?? "Starter"}</span>
                <span>{p.next ? `${fmt(p.next.xp_needed)} XP to ${p.next.tier.name}` : "Top tier"}</span>
              </div>
              <div className="mt-2 h-1 bg-white/15">
                <div className="h-full bg-nh-lime transition-all" style={{ width: `${pct}%` }} />
              </div>
              {tier && (
                <ul className="mt-5 border-t border-white/12">
                  {benefitLines(tier).map((b) => (
                    <li key={b} className="border-b border-white/12 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-nh-beige/90">
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {/* Streak */}
      <div className="border border-white/15 p-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <Eyebrow className="flex items-center gap-1.5">
              <Flame className="size-3.5 text-nh-lime" /> {p.streak.weeks > 0 ? `${p.streak.weeks}-week streak` : "Weekly streak"}
            </Eyebrow>
            <p className="mt-2 font-display text-4xl font-bold uppercase leading-none tracking-tight text-white">
              {p.streak.this_week}/{p.streak.min_sessions}
              <span className="ml-2 text-base text-nh-beige/60">this week</span>
            </p>
          </div>
          <div className="flex gap-1.5 pb-1.5">
            {Array.from({ length: p.streak.min_sessions }, (_, i) => (
              <span key={i} className={`h-6 w-3 ${i < p.streak.this_week ? "bg-nh-lime" : "bg-white/15"}`} />
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs text-nh-beige/60">
          {p.streak.this_week >= p.streak.min_sessions
            ? "Weekly goal reached. Keep it going."
            : `${plural(p.streak.min_sessions - p.streak.this_week)} more this week for the streak bonus.`}{" "}
          {fmt(p.total_sessions)} attended since you joined.
        </p>
      </div>

      {/* Leaderboard */}
      <section>
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Trophy className="size-6 text-nh-lime" strokeWidth={1.5} /> Leaderboard
          </span>
        </SectionTitle>
        <p className="-mt-2 mb-4 text-xs uppercase tracking-wide text-nh-beige/60">This month · ranked by sessions attended — consistency, not speed.</p>
        {!board ? (
          <CenterSpinner />
        ) : (
          <>
            {board.entries.length === 0 ? (
              <p className="border border-dashed border-white/20 px-4 py-6 text-center text-sm text-nh-beige/60">No one on the board yet this month. Be the first.</p>
            ) : (
              <ol className="border-t border-white/15">
                {board.entries.map((e, i) => (
                  <li key={`${e.alias}-${i}`} className={`relative flex items-center gap-4 border-b border-white/15 py-3 pl-3 pr-1 ${e.me ? "bg-nh-lime/10" : ""}`}>
                    {e.me && <span className="absolute inset-y-0 left-0 w-0.5 bg-nh-lime" />}
                    <span className={`w-7 font-display text-2xl font-bold tabular-nums ${e.rank <= 3 ? "text-nh-lime" : "text-nh-beige/50"}`}>{e.rank}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold uppercase tracking-[0.04em] text-white">
                      {e.alias}
                      {e.me && <span className="ml-1.5 text-[10px] text-nh-lime">You</span>}
                    </span>
                    {e.tier_name && <Tag>{e.tier_name}</Tag>}
                    <span className="w-24 shrink-0 whitespace-nowrap text-right text-xs font-semibold uppercase tabular-nums text-nh-beige/80">{plural(e.sessions)}</span>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-3 flex items-center justify-between gap-3 border border-white/15 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-nh-beige/80">
                {board.me.opted_in ? `You're #${board.me.rank ?? "-"} · ${plural(board.me.sessions)}` : `You're hidden · ${plural(board.me.sessions)} this month`}
              </p>
              <button type="button" disabled={busy} onClick={toggleBoard} className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-nh-lime disabled:opacity-50">
                {board.me.opted_in ? "Hide me" : "Show me"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Accordion bernomor */}
      <section className="border-t border-white/15">
        <Accordion index={1} title="How to earn XP">
          <ul>
            {p.earn_rules.map((r) => (
              <li key={r.code} className="flex items-start justify-between gap-3 border-b border-white/10 py-2.5 text-sm last:border-0">
                <span className="text-nh-beige/90">
                  {RULE_NAME[r.code] ?? r.name}
                  {ruleHint(r) && <span className="block text-xs text-nh-beige/50">{ruleHint(r)}</span>}
                </span>
                <span className="shrink-0 font-bold text-nh-lime">{ruleLabel(r)}</span>
              </li>
            ))}
          </ul>
        </Accordion>
        <Accordion index={2} title="Tier ladder">
          <div className="space-y-px bg-white/12">
            {p.tiers.map((t) => {
              const current = tier?.id === t.id;
              return (
                <div key={t.id} className={`bg-black px-4 py-3 ${current ? "outline outline-1 outline-nh-lime" : ""}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-xl font-bold uppercase tracking-tight" style={{ color: p.lifetime_xp >= t.min_lifetime_xp ? t.display_color ?? undefined : undefined }}>
                      {t.name} {current && <span className="ml-1 text-[10px] font-bold tracking-[0.12em] text-nh-lime">· Your tier</span>}
                    </p>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-nh-beige/55">{t.min_lifetime_xp === 0 ? "Start" : `${fmt(t.min_lifetime_xp)} XP`}</span>
                  </div>
                  <p className="mt-1 text-xs text-nh-beige/60">{benefitLines(t).join(" · ")}</p>
                </div>
              );
            })}
          </div>
        </Accordion>
        {p.history.length > 0 && (
          <Accordion index={3} title="XP history">
            <ul>
              {p.history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 border-b border-white/10 py-2.5 text-sm last:border-0">
                  <span className="min-w-0">
                    <span className="block truncate text-nh-beige/90">{(h.source_type && HISTORY_LABEL[h.source_type]) ?? (h.direction === "spend" ? "XP redeemed" : "XP adjustment")}</span>
                    <span className="text-[11px] uppercase tracking-wide text-nh-beige/45">{new Date(h.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })}</span>
                  </span>
                  <span className={`shrink-0 font-display text-lg font-bold tabular-nums ${h.xp_delta >= 0 ? "text-nh-lime" : "text-nh-beige/70"}`}>
                    {h.xp_delta >= 0 ? "+" : ""}
                    {fmt(h.xp_delta)}
                  </span>
                </li>
              ))}
            </ul>
          </Accordion>
        )}
      </section>
    </div>
  );
}
