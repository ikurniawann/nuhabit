"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Image from "next/image";
import { CalendarDays, Dumbbell, Home, Menu, Ticket, Trophy, X } from "lucide-react";
import { LoginScreen } from "./login-screen";
import { MemberApiError, memberFetch, type MemberProfile, type MyBooking, type MyPass } from "./lib";
import { CoachesTab } from "./tabs/coaches-tab";
import { HomeTab } from "./tabs/home-tab";
import { NewsTab } from "./tabs/news-tab";
import { PassesTab } from "./tabs/passes-tab";
import { ProfileTab } from "./tabs/profile-tab";
import { PtTab } from "./tabs/pt-tab";
import { ScheduleTab } from "./tabs/schedule-tab";
import { CenterSpinner, MarqueeWordmark, PillButton } from "./ui";

export type MemberTab = "home" | "schedule" | "pt" | "passes" | "profile" | "coaches" | "news";

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

/** Member App NüHabit (EPIC-057): satu halaman, navigasi tab bawah + menu penuh, mobile-first, gaya editorial. */
export function MemberApp() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [tab, setTab] = useState<MemberTab>("home");
  const [passes, setPasses] = useState<MyPass[] | null>(null);
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [cancelWindowHours, setCancelWindowHours] = useState(12);
  const [menuOpen, setMenuOpen] = useState(false);

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
    document.cookie = "member_preview=; Max-Age=0; path=/";
    setPasses(null);
    setBookings(null);
    setTab("home");
    setAuth({ status: "guest" });
  }, []);

  if (auth.status === "loading")
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black">
        <CenterSpinner />
      </div>
    );
  if (auth.status === "guest") return <LoginScreen onLoggedIn={loadProfile} />;
  if (auth.status === "error")
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-black px-6 text-center text-nh-beige">
        <p>{auth.message}</p>
        <PillButton onClick={loadProfile}>Try again</PillButton>
      </div>
    );

  return (
    <Ctx.Provider value={{ profile: auth.profile, passes, bookings, cancelWindowHours, refresh, go, logout }}>
      <div className="min-h-dvh bg-black text-nh-beige">
        <PreviewBanner onExit={logout} />
        <div className="mx-auto max-w-lg">
          {/* Strip CTA atas (pola "Own a Yard | Start a Trial" referensi) */}
          <div className="grid grid-cols-2 bg-nh-beige text-[11px] font-bold uppercase tracking-[0.12em] text-black">
            <button type="button" onClick={() => go("schedule")} className="border-r border-black/15 py-2.5 uppercase hover:bg-white">
              Book a class
            </button>
            <button type="button" onClick={() => go("passes")} className="py-2.5 uppercase hover:bg-white">
              Buy a pass
            </button>
          </div>
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-black/95 px-5 py-4 backdrop-blur">
            <button type="button" onClick={() => go("home")} aria-label="Home">
              <Image src="/brand/logo-white.png" alt="NUHABIT" width={1325} height={173} className="h-5 w-auto" priority />
            </button>
            <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" className="-mr-1 p-1 text-white">
              <Menu className="size-7" strokeWidth={1.25} />
            </button>
          </header>
          <main className="px-5 pb-32">
            {tab === "home" && <HomeTab />}
            {tab === "schedule" && <ScheduleTab />}
            {tab === "pt" && <PtTab />}
            {tab === "passes" && <PassesTab />}
            {tab === "profile" && <ProfileTab />}
            {tab === "coaches" && <CoachesTab />}
            {tab === "news" && <NewsTab />}
          </main>
        </div>
        <BottomNav tab={tab} onChange={go} />
        {menuOpen && <FullMenu current={tab} name={auth.profile.name} onClose={() => setMenuOpen(false)} onGo={(t) => { setMenuOpen(false); go(t); }} onLogout={() => { setMenuOpen(false); void logout(); }} />}
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
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-black pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center gap-1.5 px-1 pb-3 pt-3 text-[9px] font-bold uppercase leading-tight tracking-[0.08em] transition ${active ? "text-nh-lime" : "text-nh-beige/50 hover:text-nh-beige"}`}
            >
              {active && <span className="absolute inset-x-3 top-0 h-0.5 bg-nh-lime" />}
              <Icon className="size-[18px]" strokeWidth={1.5} />
              <span className="text-center">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

const MENU: { key: MemberTab; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "schedule", label: "Timetable" },
  { key: "pt", label: "Personal Training" },
  { key: "passes", label: "Passes" },
  { key: "profile", label: "Progress" },
  { key: "coaches", label: "Coaches" },
  { key: "news", label: "News" },
];

/** Menu layar penuh (hamburger) — daftar besar uppercase seperti navigasi referensi. */
function FullMenu({ current, name, onClose, onGo, onLogout }: { current: MemberTab; name: string | null; onClose: () => void; onGo: (t: MemberTab) => void; onLogout: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Menu" className="nh-fade-in fixed inset-0 z-50 flex flex-col overflow-y-auto bg-black text-white">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <Image src="/brand/logo-white.png" alt="NUHABIT" width={1325} height={173} className="h-5 w-auto" />
          <button type="button" onClick={onClose} aria-label="Close menu" className="-mr-1 p-1">
            <X className="size-7" strokeWidth={1.25} />
          </button>
        </div>
        <nav className="flex-1 px-5 pt-6">
          {MENU.map((m, i) => (
            <button
              key={m.key}
              type="button"
              onClick={() => onGo(m.key)}
              className={`flex w-full items-baseline gap-4 border-b border-white/10 py-3.5 text-left font-display text-[2rem] font-bold uppercase leading-none tracking-[-0.02em] transition ${current === m.key ? "text-nh-lime" : "text-white hover:text-nh-lime"}`}
            >
              <span className="w-6 text-xs font-semibold tracking-normal text-nh-beige/40">{String(i + 1).padStart(2, "0")}</span>
              {m.label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-nh-beige/55">
          <p>Signed in as {name ?? "member"}</p>
          <button type="button" onClick={onLogout} className="mt-3 text-white underline underline-offset-4 hover:text-nh-lime">
            Sign out
          </button>
        </div>
        <MarqueeWordmark />
      </div>
    </div>
  );
}

/** Banner saat staf membuka Member App tanpa OTP (cookie member_preview dari backoffice). */
function PreviewBanner({ onExit }: { onExit: () => void }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)member_preview=([^;]+)/);
    setName(m ? decodeURIComponent(m[1]) : null);
  }, []);
  if (!name) return null;
  return (
    <div className="relative z-50 flex items-center justify-center gap-3 bg-nh-lime px-4 py-1.5 text-xs font-semibold text-nh-forest">
      <span>Staff preview · viewing as {name}</span>
      <button type="button" onClick={onExit} className="rounded-full bg-nh-forest/10 px-2.5 py-0.5 underline-offset-2 hover:underline">
        Exit
      </button>
    </div>
  );
}
