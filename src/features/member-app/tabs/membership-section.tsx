"use client";

import { useEffect, useState } from "react";
import { Gem, Lock } from "lucide-react";
import { memberFetch, rupiah } from "../lib";
import { Accordion, CenterSpinner, Eyebrow, SideLabel } from "../ui";

/**
 * Kartu Membership di Member App (EPIC-069): tier dari spending 12 bulan,
 * sisa ke tier berikutnya, masa berlaku, perks, dan tangga tier.
 */

interface MembershipTier {
  id: string;
  name: string;
  min_spend: number;
  display_color: string | null;
  discount_percent: number;
  early_booking_days: number;
  cancel_window_hours: number | null;
  waitlist_priority: boolean;
  perks: string[];
}

interface Membership {
  enabled: boolean;
  frozen: boolean;
  tier: MembershipTier | null;
  valid_until: string | null;
  spend: { total: number; passes: number; pos: number; from: string; to: string };
  next: { tier: MembershipTier; spend_needed: number } | null;
  keep: { spend_needed: number; by: string | null } | null;
  tiers: MembershipTier[];
}

const dateLabel = (iso: string) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

/** Perks satu tier dalam kalimat member (terstruktur dulu, lalu perks teks dari studio). */
export function membershipPerkLines(t: MembershipTier): string[] {
  const out: string[] = [];
  if (t.early_booking_days > 0) out.push(`Book classes ${t.early_booking_days} ${t.early_booking_days === 1 ? "day" : "days"} earlier`);
  if (t.waitlist_priority) out.push("Priority on the waitlist");
  if (t.cancel_window_hours !== null) out.push(`Free cancellation up to ${t.cancel_window_hours} hours before`);
  if (t.discount_percent > 0) out.push(`${t.discount_percent}% off F&B`);
  return [...out, ...t.perks];
}

export function MembershipSection() {
  const [m, setM] = useState<Membership | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    memberFetch<{ data: Membership }>("/api/member-portal/studio/membership")
      .then((r) => setM(r.data))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  if (!m) return <CenterSpinner />;

  if (!m.enabled) {
    return (
      <div className="flex border border-white/15">
        <SideLabel>Membership</SideLabel>
        <div className="min-w-0 flex-1 p-5">
          <p className="font-display text-3xl font-bold uppercase leading-none tracking-tight text-white">Coming soon</p>
          <p className="mt-3 text-sm text-nh-beige/70">
            Membership tiers reward what you spend at NüHabit — passes, Personal Training, and F&B. Your spending already counts.
          </p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-nh-beige/60">Last 12 months · {rupiah(m.spend.total)}</p>
        </div>
      </div>
    );
  }

  const tier = m.tier;
  const base = tier?.min_spend ?? 0;
  const pct = m.next ? Math.min(100, Math.round(((m.spend.total - base) / Math.max(m.next.tier.min_spend - base, 1)) * 100)) : 100;
  const perks = tier ? membershipPerkLines(tier) : [];

  return (
    <div className="space-y-4">
      <div className="flex border border-white/15">
        <SideLabel tone="lime">Membership</SideLabel>
        <div className="min-w-0 flex-1 p-5">
          <p className="flex items-center gap-2 font-display text-5xl font-bold uppercase leading-none tracking-[-0.03em] text-white">
            <Gem className="size-8 shrink-0" style={{ color: tier?.display_color ?? undefined }} strokeWidth={1.5} /> {tier?.name ?? "Member"}
          </p>
          <div className="mt-5 grid grid-cols-2 border-y border-white/12">
            <div className="py-3">
              <Eyebrow>Spent · 12 months</Eyebrow>
              <p className="mt-1 font-display text-2xl font-bold leading-none tabular-nums text-nh-lime">{rupiah(m.spend.total)}</p>
            </div>
            <div className="border-l border-white/12 py-3 pl-4">
              <Eyebrow>{tier ? "Tier valid until" : "Tier"}</Eyebrow>
              <p className="mt-1 font-display text-2xl font-bold leading-none tabular-nums text-white">{tier && m.valid_until ? dateLabel(m.valid_until) : "—"}</p>
            </div>
          </div>

          {m.frozen ? (
            <p className="mt-5 flex items-start gap-2 border-l-2 border-nh-ochre bg-nh-ochre/10 px-3 py-2 text-sm text-nh-lemon">
              <Lock className="mt-0.5 size-4 shrink-0" /> Your membership perks are on hold. Please contact the front desk for details.
            </p>
          ) : (
            <>
              <div className="mt-5 flex items-baseline justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-nh-beige/70">
                <span>{tier?.name ?? "Member"}</span>
                <span className="text-right">{m.next ? `${rupiah(m.next.spend_needed)} to ${m.next.tier.name}` : "Top tier"}</span>
              </div>
              <div className="mt-2 h-1 bg-white/15">
                <div className="h-full bg-nh-lime transition-all" style={{ width: `${pct}%` }} />
              </div>
              {m.keep && m.keep.by && (
                <p className="mt-3 text-xs text-nh-beige/70">
                  Spend {rupiah(m.keep.spend_needed)} more (last 12 months) to keep {tier?.name} after {dateLabel(m.keep.by)}.
                </p>
              )}
              {perks.length > 0 ? (
                <ul className="mt-5 border-t border-white/12">
                  {perks.map((b) => (
                    <li key={b} className="border-b border-white/12 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-nh-beige/90">
                      {b}
                    </li>
                  ))}
                </ul>
              ) : (
                !tier && m.next && <p className="mt-4 text-xs text-nh-beige/70">Reach {m.next.tier.name} to unlock member perks.</p>
              )}
            </>
          )}
        </div>
      </div>

      <section className="border-t border-white/15">
        <Accordion title="Membership tiers">
          <p className="mb-3 text-xs text-nh-beige/60">
            Based on what you spend in the last 12 months on passes, Personal Training, and F&B. You move up as soon as you reach a
            tier, and keep it for 12 months from the last time you qualified.
          </p>
          <div className="space-y-px bg-white/12">
            {m.tiers.map((t) => {
              const current = tier?.id === t.id;
              const lines = membershipPerkLines(t);
              return (
                <div key={t.id} className={`bg-black px-4 py-3 ${current ? "outline outline-1 outline-nh-lime" : ""}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-display text-xl font-bold uppercase tracking-tight" style={{ color: m.spend.total >= t.min_spend ? (t.display_color ?? undefined) : undefined }}>
                      {t.name} {current && <span className="ml-1 text-[10px] font-bold tracking-[0.12em] text-nh-lime">· Your tier</span>}
                    </p>
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-nh-beige/55">{t.min_spend === 0 ? "Start" : rupiah(t.min_spend)}</span>
                  </div>
                  {lines.length > 0 && <p className="mt-1 text-xs text-nh-beige/60">{lines.join(" · ")}</p>}
                </div>
              );
            })}
          </div>
        </Accordion>
      </section>
    </div>
  );
}
