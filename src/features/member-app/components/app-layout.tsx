"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bell, CalendarDays, Home, QrCode, Search, User } from "lucide-react";
import { OfflineBanner } from "@/features/member-portal/mobile/mobile-pwa";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { initialsOf } from "../lib/initials";
import { asset, m } from "../lib/links";
import { useMe } from "../lib/queries";
import { Spinner } from "../ui";
import "../member-app.css";

const NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/classes", label: "Classes", icon: CalendarDays },
  { to: "/qr", label: "QR", icon: QrCode, emphasized: true },
  { to: "/train", label: "Train", icon: Activity },
  { to: "/profile", label: "Profile", icon: User },
];

const ROUND_BUTTON =
  "flex h-10 w-10 items-center justify-center rounded-full bg-nh-ink-soft text-white shadow-[0_4px_14px_rgb(0_40_26/0.18)]";

/** Sesi member wajib; tanpa sesi diarahkan ke /member/auth/login (kembali ke halaman asal). */
function RequireAuth({ children }: { children: ReactNode }) {
  const { data, error } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const unauthenticated = error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace(`${m("/auth/login")}?from=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);

  if (data) return <>{children}</>;
  if (error && !unauthenticated) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-8 text-center text-sm text-nh-muted">
        NüHabit belum bisa dimuat. Periksa koneksi lalu muat ulang.
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label="Opening NüHabit…" />
    </div>
  );
}

/** Kerangka aplikasi member: header bulat, wordmark tengah, nav pil mengambang dengan QR lime. */
export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="nh-app">
      <RequireAuth>
        <Shell>{children}</Shell>
      </RequireAuth>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const t = useT();
  const pathname = usePathname();
  const isActive = (to: string) => (to === "/" ? pathname === m("/") : pathname.startsWith(m(to)));

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <OfflineBanner />
      <header className="pointer-events-none fixed inset-x-0 top-0 z-20 mx-auto flex max-w-md items-center justify-between bg-gradient-to-b from-nh-beige via-nh-beige/75 to-transparent px-5 pt-[max(env(safe-area-inset-top),1.1rem)] pb-4 [&_a]:pointer-events-auto">
        <div className="flex items-center gap-2.5">
          <Link
            href={m("/profile")}
            aria-label={t("Profile")}
            className="block h-10 w-10 shrink-0 overflow-hidden rounded-full bg-nh-ink-soft shadow-[0_4px_14px_rgb(0_40_26/0.18)]"
          >
            {me?.member.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.member.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-sm font-black text-white">
                {me && initialsOf(me.member.fullName)}
              </span>
            )}
          </Link>
          <Link href={m("/train/explore")} aria-label="Explore" className={ROUND_BUTTON}>
            <Search size={17} strokeWidth={2.4} />
          </Link>
        </div>
        {/* Wordmark hitam di atas latar beige. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset("/brand/wordmark-black.png")}
          alt="NüHabit"
          className="pointer-events-none absolute top-[max(env(safe-area-inset-top),1.1rem)] left-1/2 h-[18px] w-auto -translate-x-1/2 translate-y-[11px]"
        />
        <Link href={m("/notifications")} className={`relative ${ROUND_BUTTON}`} aria-label={t("Notifications")}>
          <Bell size={17} strokeWidth={2.4} />
          {me && me.unreadNotifications > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-nh-forest px-1 text-[10px] font-black text-white ring-2 ring-nh-beige">
              {me.unreadNotifications}
            </span>
          ) : null}
        </Link>
      </header>
      <main className="flex-1 px-5 pt-[4.75rem] pb-28">
        <div key={pathname} className="nh-page-enter">
          {children}
        </div>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        <div className="nh-surface-ink flex items-center justify-between rounded-full px-3 py-2.5 shadow-[0_18px_40px_rgb(0_40_26/0.35)]">
          {NAV.map(({ to, label, icon: Icon, emphasized }) => {
            const active = isActive(to);
            return (
              <Link
                key={to}
                href={m(to)}
                aria-label={t(label)}
                aria-current={active ? "page" : undefined}
                title={t(label)}
                className={
                  emphasized
                    ? "nh-surface-brand flex h-12 w-12 items-center justify-center rounded-full text-nh-ink shadow-[0_6px_18px_rgb(218_255_89/0.35)] transition active:scale-95"
                    : `flex h-12 w-12 items-center justify-center rounded-full transition active:scale-95 ${
                        active ? "bg-white/12 text-white" : "text-white/45"
                      }`
                }
              >
                <Icon size={emphasized ? 22 : 21} strokeWidth={emphasized || active ? 2.4 : 2} />
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
