"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useMember } from "../member-app";
import { firstName, memberFetch } from "../lib";
import { Eyebrow, PageTitle, PillButton } from "../ui";
import { ProgressSection } from "./progress-section";

/** Tab Progress: tier, XP, streak, leaderboard, pengaturan pengingat, keluar. */
export function ProfileTab() {
  const { profile, logout } = useMember();

  return (
    <div className="space-y-8">
      <PageTitle sub={`${profile.name ?? "Member"} · ${profile.phone ?? ""}`}>
        Keep going,
        <br />
        {firstName(profile.name)}.
      </PageTitle>

      <ProgressSection />

      <section className="border-t border-white/15">
        <Eyebrow className="pb-2 pt-6">Settings</Eyebrow>
        <ReminderToggle />
      </section>

      <PillButton variant="ghost" className="w-full" onClick={logout}>
        <LogOut className="size-4" /> Sign out
      </PillButton>
    </div>
  );
}

/** Pengingat WhatsApp (H-1 sesi, waitlist, paket) — member bisa mematikannya. */
function ReminderToggle() {
  return <ToggleRow label="WhatsApp reminders" hint="Tomorrow's sessions, waitlist spots, and passes running low." prefKey="wa_reminders" defaultValue />;
}

function ToggleRow({ label, hint, prefKey, defaultValue }: { label: string; hint: string; prefKey: "wa_reminders" | "leaderboard_opt_in"; defaultValue: boolean }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    memberFetch<{ data: Record<string, boolean> }>("/api/member-portal/studio/prefs")
      .then((r) => setOn(r.data[prefKey] ?? defaultValue))
      .catch(() => setOn(defaultValue));
  }, [prefKey, defaultValue]);

  async function toggle() {
    if (on === null) return;
    setBusy(true);
    try {
      await memberFetch("/api/member-portal/studio/prefs", { method: "PUT", body: { [prefKey]: !on } });
      setOn(!on);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/15 py-4">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.04em] text-white">{label}</p>
        <p className="mt-1 text-xs text-nh-beige/60">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-label={label}
        disabled={on === null || busy}
        onClick={toggle}
        className={`relative h-7 w-12 shrink-0 border transition disabled:opacity-60 ${on ? "border-nh-lime bg-nh-lime" : "border-white/30 bg-transparent"}`}
      >
        <span className={`absolute top-1 size-[18px] transition-all ${on ? "left-[26px] bg-black" : "left-1 bg-nh-beige"}`} />
      </button>
    </div>
  );
}
