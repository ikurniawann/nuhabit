"use client";

import { Check, Copy, Gift, Share2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { discountLabel } from "@/lib/member-portal/referral";
import { useErrorText } from "../lib/error-codes";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { FRIEND_STATUS, referralLink, useReferral, type ReferralStatus, type ReferralView } from "../lib/queries-referral";
import { Notice, PageTitle } from "../loyalty/loyalty-ui";
import { EmptyState, Spinner, StatusBadge, formatDay, formatIdr, type Tone } from "../ui";

const FRIEND_TONE: Record<ReferralStatus, Tone> = {
  joined: "info",
  held: "warn",
  rewarded: "ok",
  capped: "neutral",
  void: "neutral",
  blocked: "danger",
};

/** Ajak teman: the member's code and link, what both sides get, and the friends who used it. */
export function ReferralPage() {
  const t = useT();
  const errorText = useErrorText();
  const { data, isLoading, error } = useReferral();

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Share your code. When a friend joins and buys their first package, you both get rewarded.")}>
        {t("Invite friends")}
      </PageTitle>
      {isLoading ? <Spinner label={t("Loading…")} /> : null}
      {error ? <Notice ok={false}>{errorText(error, t("Request failed"))}</Notice> : null}
      {data ? <ReferralContent view={data} /> : null}
    </div>
  );
}

function ReferralContent({ view }: { view: ReferralView }) {
  const t = useT();
  const { program, stats } = view;

  return (
    <>
      {view.welcome ? <WelcomeCard welcome={view.welcome} /> : null}
      {program.active ? (
        <ShareCard code={view.code} />
      ) : (
        <Notice ok={false}>{t("The referral program is paused right now. Your code still works when it returns.")}</Notice>
      )}

      {program.active ? (
        <section className="nh-card flex flex-col gap-3 text-sm">
          <p className="nh-label !mb-0">{t("Rewards")}</p>
          <RewardRow title={t("You get")} lines={referrerRewards(view, t)} />
          <RewardRow title={t("Your friend gets")} lines={refereeRewards(view, t)} />
          <p className="text-xs text-nh-muted">
            {program.hold_days > 0
              ? t("Rewards arrive {days} days after your friend's first paid package, as long as it is not refunded.", {
                  days: program.hold_days,
                })
              : t("Rewards arrive after your friend's first paid package.")}
          </p>
        </section>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("Invited")} value={stats.invited} />
        <Stat label={t("Bought")} value={stats.joined} />
        <Stat label={t("Rewarded")} value={stats.rewarded} />
      </div>

      <section className="nh-card flex flex-col gap-3 text-sm">
        <p className="nh-label !mb-0">{t("Your friends")}</p>
        {view.friends.length === 0 ? (
          <EmptyState title={t("No friends yet")} hint={t("Friends who sign up with your code show up here.")} />
        ) : (
          <ul className="flex flex-col divide-y divide-nh-line">
            {view.friends.map((f, i) => (
              <li key={`${f.joined_at}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-bold">{f.name}</span>
                  <span className="block text-xs text-nh-muted">{t("Joined {date}", { date: formatDay(f.joined_at) })}</span>
                </span>
                <StatusBadge status={FRIEND_STATUS[f.status]} tone={FRIEND_TONE[f.status]} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ShareCard({ code }: { code: string }) {
  const t = useT();
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const copy = async (what: "code" | "link", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };

  const share = async () => {
    const url = referralLink(window.location.origin, code);
    const text = t("Join me at NüHabit. Sign up with my code {code}.", { code });
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "NüHabit", text, url });
        return;
      } catch {
        // Cancelled or blocked: fall back to copying the link.
      }
    }
    await copy("link", `${text} ${url}`);
  };

  return (
    <div className="nh-card nh-surface-ink !border-0 !p-6 text-white">
      <p className="text-[11px] font-extrabold tracking-[0.16em] text-white/70 uppercase">{t("Your code")}</p>
      <p className="nh-display mt-1 text-4xl font-black tracking-[0.12em] break-all">{code}</p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button type="button" className="nh-btn-brand flex-1" onClick={() => void share()}>
          {copied === "link" ? <Check size={18} /> : <Share2 size={18} />}
          {copied === "link" ? t("Link copied") : t("Share invite link")}
        </button>
        <button type="button" className="nh-btn-ghost flex-1" onClick={() => void copy("code", code)}>
          {copied === "code" ? <Check size={18} /> : <Copy size={18} />}
          {copied === "code" ? t("Code copied") : t("Copy code")}
        </button>
      </div>
    </div>
  );
}

function WelcomeCard({ welcome }: { welcome: NonNullable<ReferralView["welcome"]> }) {
  const t = useT();
  return (
    <section className="nh-card flex flex-col gap-2 text-sm">
      <p className="flex items-center gap-2 font-bold">
        <Gift size={16} /> {t("Invited by {name}", { name: welcome.referrer_name })}
      </p>
      {welcome.voucher_code ? (
        <>
          <p className="text-nh-muted">{t("Your welcome voucher for your first package:")}</p>
          <div className="flex items-center justify-between gap-3">
            <span className="nh-chip bg-nh-lime text-nh-forest">{welcome.voucher_code}</span>
            <Link href={`${m("/wallet/topup")}?voucher=${encodeURIComponent(welcome.voucher_code)}`} className="font-bold text-nh-forest">
              {t("Use it")}
            </Link>
          </div>
        </>
      ) : null}
    </section>
  );
}

function RewardRow({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <p className="font-bold">{title}</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-nh-muted">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="nh-card flex flex-col items-center gap-1 !p-3 text-center">
      <span className="nh-display text-2xl font-black">{value}</span>
      <span className="text-[11px] font-bold tracking-wider text-nh-muted uppercase">{label}</span>
    </div>
  );
}

type Translate = ReturnType<typeof useT>;

/** What the member gets per friend, one line per reward. */
export function referrerRewards(view: ReferralView, t: Translate): string[] {
  const { referrer_credits: credits, referrer_ark_idr: ark } = view.program;
  const lines: string[] = [];
  if (credits > 0) lines.push(t("{n} bonus class credits", { n: credits }));
  if (ark > 0) lines.push(t("{amount} in ARK Coin", { amount: formatIdr(ark) }));
  return lines;
}

/** What the friend gets, one line per reward. */
export function refereeRewards(view: ReferralView, t: Translate): string[] {
  const { referee_credits: credits, referee_discount: discount } = view.program;
  const lines: string[] = [];
  if (discount) lines.push(t("{discount} off their first package", { discount: discountLabel(discount, formatIdr) }));
  if (credits > 0) lines.push(t("{n} bonus class credits", { n: credits }));
  return lines;
}
