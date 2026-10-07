"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Camera, Mail, MessageCircle, Music2, Play } from "lucide-react";
import type { BranchSummary, SocialContent } from "../types";
import { BRANCH_COOKIE, readBranchCookie, useSitePanels, writeBranchCookie } from "./panels";
import { BRAND_NAV, BUSINESS_NAV } from "./site-header";

const listeners = new Set<() => void>();
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The remembered branch slug; "" on the server and before hydration. */
function useBranchSlug(): [string, (slug: string) => void] {
  const slug = useSyncExternalStore(subscribe, () => readBranchCookie(document.cookie) ?? "", () => "");
  const set = (next: string) => {
    writeBranchCookie(next);
    listeners.forEach((fn) => fn());
  };
  return [slug, set];
}

function BranchSwitcher({ branches }: { branches: BranchSummary[] }) {
  const [slug, setSlug] = useBranchSlug();
  if (branches.length === 0) return null;
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-foreground">Your branch</span>
      <select
        name={BRANCH_COOKIE}
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        className="h-10 rounded-full border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <option value="">Choose a branch</option>
        {branches.map((b) => (
          <option key={b.slug} value={b.slug}>
            {b.name}
            {b.city ? ` · ${b.city}` : ""}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">The timetable, trial and membership follow this branch.</span>
    </label>
  );
}

function SocialLinks({ social }: { social: SocialContent }) {
  const items = [
    { href: social.instagram, label: "Instagram", Icon: Camera },
    { href: social.tiktok, label: "TikTok", Icon: Music2 },
    { href: social.youtube, label: "YouTube", Icon: Play },
    { href: social.whatsapp ? `https://wa.me/${social.whatsapp.replace(/\D/g, "")}` : "", label: "WhatsApp", Icon: MessageCircle },
    { href: social.email ? `mailto:${social.email}` : "", label: "Email", Icon: Mail },
  ].filter((item) => item.href);
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map(({ href, label, Icon }) => (
        <li key={label}>
          <a
            href={href}
            target={href.startsWith("http") ? "_blank" : undefined}
            rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
            aria-label={label}
            className="flex size-10 items-center justify-center rounded-full bg-card text-foreground shadow-card transition-colors hover:bg-surface-2"
          >
            <Icon className="size-4" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SiteFooter({ branches, social }: { branches: BranchSummary[]; social: SocialContent }) {
  const year = new Date().getFullYear();
  const panels = useSitePanels();
  return (
    <footer className="mt-16 bg-surface">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-12 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] lg:px-6">
        <div className="space-y-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wordmark-black.png" alt="NüHabit" className="h-6 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wordmark-white.png" alt="NüHabit" className="hidden h-6 w-auto dark:block" />
          <p className="max-w-sm text-sm text-body">
            A HYROX gym built around a measurable 8-week program. Training that turns into a habit.
          </p>
          <BranchSwitcher branches={branches} />
          <SocialLinks social={social} />
        </div>
        <nav aria-label="Pages" className="text-sm">
          <p className="mb-3 font-semibold text-foreground">Explore</p>
          <ul className="space-y-2">
            {BRAND_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-body hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => panels.open("membership")} className="text-body hover:text-foreground">
                Membership
              </button>
            </li>
          </ul>
        </nav>
        <nav aria-label="Business" className="text-sm">
          <p className="mb-3 font-semibold text-foreground">NüHabit</p>
          <ul className="space-y-2">
            {BUSINESS_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-body hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/franchise" className="text-body hover:text-foreground">
                Own a Gym
              </Link>
            </li>
            <li>
              <Link href="/wholesale" className="font-semibold text-forest hover:underline">
                Partner Portal
              </Link>
            </li>
            <li>
              <Link href="/member" className="text-body hover:text-foreground">
                Member Area
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <p>© {year} NüHabit. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms & Conditions
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
