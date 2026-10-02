"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Image from "next/image";
import { CalendarDays, Dumbbell, Home, Ticket, Trophy } from "lucide-react";
import { LoginScreen } from "./login-screen";
import { MemberApiError, memberFetch, type MemberProfile, type MyBooking, type MyPass } from "./lib";
import { HomeTab } from "./tabs/home-tab";
import { PassesTab } from "./tabs/passes-tab";
import { ProfileTab } from "./tabs/profile-tab";
import { PtTab } from "./tabs/pt-tab";
import { ScheduleTab } from "./tabs/schedule-tab";
import { CenterSpinner, PillButton } from "./ui";

export type MemberTab = "home" | "schedule" | "pt" | "passes" | "profile";

interface MemberData {
  profile: MemberProfile;
  passes: MyPass[] | null;
  bookings: MyBooking[] | null;
  /** Batas batal (jam) dari Aturan Booking venue. */
  cancelWindowHours: number;
  /** Muat ulang pass & booking (setelah booking/batal/beli). */
  refresh: () => Promise<void>;
  go: (tab: MemberTab) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<MemberData | null>(null);

export function useMember(): MemberData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMember di luar MemberApp");
  return v;
}

type AuthState = { status: "loading" } | { status: "guest" } | { status: "error"; message: string } | { status: "ready"; profile: MemberProfile };

/** Member App NüHabit (EPIC-057): satu halaman, navigasi tab bawah, mobile-first. */
export function MemberApp() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [tab, setTab] = useState<MemberTab>("home");
  const [passes, setPasses] = useState<MyPass[] | null>(null);
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [cancelWindowHours, setCancelWindowHours] = useState(12);

  const loadProfile = useCallback(async () => {
    try {
      const res = await memberFetch<{ data: { profile: MemberProfile } }>("/api/member-portal/me");
      setAuth({ status: "ready", profile: res.data.profile });
    } catch (e) {
      if (e instanceof MemberApiError && e.status === 401) setAuth({ status: "guest" });
      else setAuth({ status: "error", message: e instanceof Error ? e.message : "Couldn't load your account" });
    }
  }, []);

  const refresh = useCallback(async () => {
    const [p, b] = await Promise.allSettled([
      memberFetch<{ data: MyPass[] }>("/api/member-portal/studio/passes"),
      memberFetch<{ data: MyBooking[]; rules?: { cancel_window_hours: number } }>("/api/member-portal/studio/bookings"),
    ]);
    setPasses(p.status === "fulfilled" ? p.value.data : []);
    setBookings(b.status === "fulfilled" ? b.value.data : []);
    if (b.status === "fulfilled" && b.value.rules) setCancelWindowHours(b.value.rules.cancel_window_hours);
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (auth.status === "ready") void refresh();
  }, [auth.status, refresh]);

  const go = useCallback((t: MemberTab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/member-portal/logout", { method: "POST" }).catch(() => {});
    setPasses(null);
    setBookings(null);
    setTab("home");
    setAuth({ status: "guest" });
  }, []);

  if (auth.status === "loading")
    return (
      <div className="flex min-h-dvh items-center justify-center bg-nh-ink">
        <CenterSpinner />
      </div>
    );
  if (auth.status === "guest") return <LoginScreen onLoggedIn={loadProfile} />;
  if (auth.status === "error")
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-nh-ink px-6 text-center text-nh-beige">
        <p>{auth.message}</p>
        <PillButton onClick={loadProfile}>Try again</PillButton>
      </div>
    );

  return (
    <Ctx.Provider value={{ profile: auth.profile, passes, bookings, cancelWindowHours, refresh, go, logout }}>
      <div className="min-h-dvh bg-nh-ink text-nh-beige">
        <div className="mx-auto max-w-lg">
          <header className="sticky top-0 z-30 flex items-center justify-between bg-nh-ink/90 px-5 py-4 backdrop-blur">
            <Image src="/brand/logo-neon.png" alt="NUHABIT" width={1325} height={173} className="h-4 w-auto" priority />
            <button type="button" onClick={() => go("profile")} className="text-xs text-nh-beige/60">
              {auth.profile.name ?? "Profile"}
            </button>
          </header>
          <main className="px-5 pb-32">
            {tab === "home" && <HomeTab />}
            {tab === "schedule" && <ScheduleTab />}
            {tab === "pt" && <PtTab />}
            {tab === "passes" && <PassesTab />}
            {tab === "profile" && <ProfileTab />}
          </main>
        </div>
        <BottomNav tab={tab} onChange={go} />
      </div>
    </Ctx.Provider>
  );
}

const NAV: { key: MemberTab; label: string; icon: typeof Home }[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "schedule", label: "Classes", icon: CalendarDays },
  { key: "pt", label: "Personal Training", icon: Dumbbell },
  { key: "passes", label: "Passes", icon: Ticket },
  { key: "profile", label: "Progress", icon: Trophy },
];

function BottomNav({ tab, onChange }: { tab: MemberTab; onChange: (t: MemberTab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-nh-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-1 px-1 pb-3 pt-2.5 text-[10px] font-semibold leading-tight transition ${active ? "text-nh-lime" : "text-nh-beige/55"}`}
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? "bg-nh-lime/15" : ""}`}>
                <Icon className="size-[18px]" />
              </span>
              <span className="text-center">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
