"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { CalendarDays, Home, IdCard, RefreshCw, Ticket, User, type LucideIcon } from "lucide-react";
import "./member-mobile.css";
import { parsePortalLink, type PortalLink } from "@/lib/member-portal/links";
import { useNoxMember } from "../nox/use-nox-member";
import { useMemberDetails } from "../use-member-details";
import { ClassesScreen } from "./gym/classes-screen";
import { CoachesScreen } from "./gym/coaches-screen";
import { GymCreditsScreen } from "./gym/credits-screen";
import { MyClassesScreen } from "./gym/my-classes-screen";
import { RacesScreen } from "./gym/races-screen";
import { WorkoutScreen } from "./gym/workout-screen";
import { MobileLogin } from "./mobile-login";
import { BellButton, ChallengesScreen, EventsScreen, MemberQr, NotificationsSheet } from "./mobile-engagement";
import { useT } from "./mobile-i18n";
import { BadgesScreen, CollectionScreen, RewardsScreen } from "./mobile-loyalty";
import { MemberAvatar, ProfileScreen } from "./mobile-profile";
import { PromoSheet, PromosScreen } from "./mobile-promos";
import { ReviewsScreen } from "./mobile-reviews";
import { OfflineBanner, useMemberServiceWorker } from "./mobile-pwa";
import { TopupScreen, WALLET_UPDATED_EVENT } from "./mobile-topup";
import {
  CoinsScreen,
  HistoryScreen,
  HomeScreen,
  type MobileSheet,
  type MobileTab,
} from "./mobile-screens";
import { MemberCardSheet, OrderSheet, TierSheet, VisitsSheet } from "./mobile-sheets";

const NAV: Array<{ tab: MobileTab; label: string; icon: LucideIcon }> = [
  { tab: "home", label: "Beranda", icon: Home },
  { tab: "classes", label: "Kelas", icon: CalendarDays },
  { tab: "credits", label: "Kredit", icon: Ticket },
  { tab: "profile", label: "Profil", icon: User },
];

const HEADER_BUTTON =
  "flex size-10 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white shadow-[0_4px_14px_rgb(0_40_26/0.18)] active:scale-95";

/** Tujuan dari tautan push (`/member?go=events`); null di server atau tanpa parameter. */
function readGoLink(): PortalLink | null {
  if (typeof window === "undefined") return null;
  return parsePortalLink(new URLSearchParams(window.location.search).get("go"));
}

/**
 * Portal member /member dengan tampilan mobile NüHabit: header bulat, kartu
 * saldo gelap, tile aksi cepat, dan nav pil mengambang dengan tombol tengah
 * lime untuk kartu member. Bisa dipasang sebagai PWA dan menerima web push.
 */
export function MobilePortal() {
  const t = useT();
  const { state, reload, refresh } = useNoxMember();
  const details = useMemberDetails();
  // Tautan push membuka portal langsung di tujuannya.
  const [goLink] = useState(readGoLink);
  const [tab, setTab] = useState<MobileTab>(goLink?.kind === "tab" ? goLink.tab : "home");
  const [sheet, setSheet] = useState<MobileSheet | null>(
    goLink?.kind === "promo" ? { type: "promo", code: goLink.code } : null
  );
  const closeSheet = useCallback(() => setSheet(null), []);
  useMemberServiceWorker();

  // Top-up QRIS lunas: saldo berubah, muat ulang data tanpa layar memuat.
  useEffect(() => {
    window.addEventListener(WALLET_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(WALLET_UPDATED_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    if (!goLink) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("go");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [goLink]);

  const goTab = useCallback((next: MobileTab) => {
    setTab(next);
    window.scrollTo({ top: 0 });
  }, []);

  const openSheet = (next: MobileSheet) => {
    setSheet(next);
    if (next.type === "order") void details.loadOrder(next.id);
    if (next.type === "visits") void details.loadVisits();
  };

  const openLink = useCallback(
    (raw: string) => {
      const link = parsePortalLink(raw);
      if (!link) return;
      if (link.kind === "promo") {
        setSheet({ type: "promo", code: link.code });
      } else {
        setSheet(null);
        goTab(link.tab);
      }
    },
    [goTab]
  );

  const logout = async () => {
    await fetch("/api/member-portal/logout", { method: "POST" }).catch(() => {});
    setTab("home");
    reload();
  };

  if (state.status === "unauthenticated") {
    return (
      <div className="nh-app">
        <OfflineBanner />
        <div className="mx-auto max-w-md">
          <MobileLogin onSignedIn={reload} />
        </div>
      </div>
    );
  }

  if (state.status !== "ready") {
    return (
      <div className="nh-app flex flex-col items-center justify-center gap-4 px-6 text-center">
        <OfflineBanner />
        {state.status === "error" ? (
          <>
            <p className="nh-display text-2xl">{t("Profil belum bisa dimuat")}</p>
            <p className="text-sm text-nh-muted">{t("Periksa koneksi Anda, lalu coba lagi.")}</p>
            <button type="button" onClick={reload} className="nh-btn-brand">
              {t("Coba lagi")}
            </button>
          </>
        ) : (
          <>
            <span className="size-7 animate-spin rounded-full border-[3px] border-nh-forest/15 border-t-nh-forest" />
            <p className="text-sm font-semibold text-nh-muted">{t("Memuat profil member…")}</p>
          </>
        )}
      </div>
    );
  }

  const { member, wallet, orders } = state;
  const screenProps = { member, wallet, orders, goTab, openSheet };

  return (
    <div className="nh-app">
      <OfflineBanner />
      <div className="mx-auto flex min-h-dvh max-w-md flex-col">
        <header className="pointer-events-none fixed inset-x-0 top-0 z-20 mx-auto flex max-w-md items-center justify-between bg-gradient-to-b from-nh-beige via-nh-beige/75 to-transparent px-5 pt-[max(env(safe-area-inset-top),1.1rem)] pb-4 [&_button]:pointer-events-auto">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => goTab("profile")}
              aria-label={t("Profil")}
              className={`${HEADER_BUTTON} overflow-hidden`}
            >
              <MemberAvatar member={member} className="size-full rounded-full text-sm" />
            </button>
            <button type="button" onClick={reload} aria-label={t("Muat ulang data")} className={HEADER_BUTTON}>
              <RefreshCw size={17} strokeWidth={2.4} />
            </button>
          </div>
          <Image
            src="/member-assets/brand/wordmark-black.png"
            alt="NüHabit"
            width={1200}
            height={165}
            unoptimized
            className="h-[18px] w-auto"
          />
          <BellButton className={HEADER_BUTTON} onClick={() => openSheet({ type: "notifications" })} />
        </header>

        <main className="flex-1 px-5 pt-[4.75rem] pb-32">
          <div key={tab} className="nh-page-enter">
            {tab === "home" && <HomeScreen {...screenProps} />}
            {tab === "coins" && <CoinsScreen {...screenProps} />}
            {tab === "topup" && <TopupScreen />}
            {tab === "history" && <HistoryScreen {...screenProps} />}
            {tab === "profile" && (
              <ProfileScreen
                member={member}
                openSheet={openSheet}
                goTab={goTab}
                onLogout={() => void logout()}
                onChanged={refresh}
              />
            )}
            {tab === "events" && <EventsScreen />}
            {tab === "challenges" && <ChallengesScreen />}
            {tab === "promos" && <PromosScreen onOpen={(code) => openSheet({ type: "promo", code })} />}
            {tab === "rewards" && <RewardsScreen />}
            {tab === "badges" && <BadgesScreen />}
            {tab === "collection" && <CollectionScreen />}
            {tab === "reviews" && <ReviewsScreen />}
            {tab === "classes" && <ClassesScreen onBuyCredits={() => goTab("credits")} />}
            {tab === "my-classes" && <MyClassesScreen onFindClass={() => goTab("classes")} />}
            {tab === "credits" && <GymCreditsScreen onBookClass={() => goTab("classes")} />}
            {tab === "coaches" && <CoachesScreen />}
            {tab === "workout" && <WorkoutScreen onOpenRaces={() => goTab("races")} />}
            {tab === "races" && <RacesScreen onStartSimulation={() => goTab("workout")} />}
          </div>
        </main>

        <nav
          aria-label={t("Navigasi portal member")}
          className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]"
        >
          <div className="nh-surface-ink flex items-center justify-between rounded-full px-3 py-2.5 shadow-[0_18px_40px_rgb(0_40_26/0.35)]">
            {NAV.slice(0, 2).map((item) => (
              <NavButton
                key={item.tab}
                {...item}
                label={t(item.label)}
                active={tab === item.tab}
                onClick={() => goTab(item.tab)}
              />
            ))}
            <button
              type="button"
              onClick={() => openSheet({ type: "card" })}
              aria-label={t("Kartu member")}
              title={t("Kartu member")}
              className="nh-surface-brand flex size-12 items-center justify-center rounded-full text-nh-ink shadow-[0_6px_18px_rgb(218_255_89/0.35)] transition active:scale-95"
            >
              <IdCard size={22} strokeWidth={2.4} />
            </button>
            {NAV.slice(2).map((item) => (
              <NavButton
                key={item.tab}
                {...item}
                label={t(item.label)}
                active={tab === item.tab}
                onClick={() => goTab(item.tab)}
              />
            ))}
          </div>
        </nav>
      </div>

      {sheet?.type === "card" && <MemberCardSheet member={member} qr={<MemberQr />} onClose={closeSheet} />}
      {sheet?.type === "notifications" && <NotificationsSheet onClose={closeSheet} onNavigate={openLink} />}
      {sheet?.type === "tier" && <TierSheet member={member} onClose={closeSheet} />}
      {sheet?.type === "promo" && <PromoSheet code={sheet.code} onClose={closeSheet} />}
      {sheet?.type === "visits" && (
        <VisitsSheet visits={details.visits} busy={details.busy} error={details.error} onClose={closeSheet} />
      )}
      {sheet?.type === "order" && (
        <OrderSheet
          nomor={sheet.nomor}
          detail={details.order}
          busy={details.busy}
          error={details.error}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}

function NavButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
      className={`flex size-12 items-center justify-center rounded-full transition active:scale-95 ${
        active ? "bg-white/12 text-white" : "text-white/45"
      }`}
    >
      <Icon size={21} strokeWidth={active ? 2.4 : 2} />
    </button>
  );
}
