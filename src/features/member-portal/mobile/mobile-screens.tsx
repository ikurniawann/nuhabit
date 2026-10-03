"use client";

import {
  AlertTriangle,
  Award,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  Coins,
  Dumbbell,
  Flag,
  Gift,
  IdCard,
  ReceiptText,
  Sparkles,
  Ticket,
  TicketPercent,
  Timer,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { isLowBalance } from "@/lib/member-portal/balance";
import type { PortalTab } from "@/lib/member-portal/links";
import { angka, tanggal, TXN_LABELS } from "../format";
import { isCreditEntry } from "@/lib/wallet/ledger";
import type { NoxMemberData, NoxOrder, NoxWalletTxn } from "../nox/use-nox-member";
import { ChallengeHighlights, ProgressBar, UpcomingEvents } from "./mobile-engagement";
import { useLocale, useT } from "./mobile-i18n";
import { PromoRail } from "./mobile-promos";
import { EmptyCard, ScreenTitle, SectionHeader, SeeAll } from "./mobile-ui";

export type MobileTab = PortalTab;
export type MobileSheet =
  | { type: "card" }
  | { type: "notifications" }
  | { type: "tier" }
  | { type: "visits" }
  | { type: "order"; id: string; nomor: string }
  | { type: "promo"; code: string };

interface ScreenProps {
  member: NoxMemberData;
  wallet: NoxWalletTxn[];
  orders: NoxOrder[];
  goTab: (tab: MobileTab) => void;
  openSheet: (sheet: MobileSheet) => void;
}

/** Kartu saldo gelap premium; tap membuka kartu member. Saldo di bawah ambang memunculkan chip top-up. */
function BalanceCard({
  member,
  onOpen,
  onTopup,
}: {
  member: NoxMemberData;
  onOpen?: () => void;
  onTopup: () => void;
}) {
  const t = useT();
  const low = isLowBalance(member.coinsIdr, member.lowBalanceThresholdIdr);
  const shell = "nh-card nh-surface-ink relative block w-full overflow-hidden !border-0 !p-6 text-left text-white";
  const content = (
    <>
      <div className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-nh-lime/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-10 size-48 rounded-full bg-white/[0.04] blur-2xl" />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">{t("Saldo ARK Coin")}</p>
          <p className="nh-display mt-1 text-7xl leading-none tabular-nums">{angka(member.coins)}</p>
          <p className="mt-2 text-xs font-semibold text-white/45">≈ Rp {angka(member.coinsIdr)}</p>
        </div>
        {onOpen && (
          <span className="flex size-11 items-center justify-center rounded-2xl bg-white/10">
            <IdCard size={22} className="text-white/80" />
          </span>
        )}
      </div>
      <div className="relative mt-5 flex items-center justify-between gap-3">
        <p className="truncate text-xs font-semibold text-white/45">{member.profile.name ?? "Member"}</p>
        {member.tier && <span className="nh-chip shrink-0 bg-white/10 text-white/80">{member.tier.name}</span>}
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-2">
      {onOpen ? (
        <button type="button" onClick={onOpen} className={`${shell} active:scale-[0.99]`}>
          {content}
        </button>
      ) : (
        <div className={shell}>{content}</div>
      )}
      {low && (
        <button
          type="button"
          onClick={onTopup}
          className="flex items-center gap-2 rounded-2xl bg-nh-warn/15 px-4 py-3 text-left text-sm font-bold text-nh-ink active:scale-[0.99]"
        >
          <AlertTriangle size={16} className="shrink-0 text-nh-warn" />
          <span className="flex-1">{t("Saldo menipis. Isi ulang sekarang")}</span>
          <ChevronRight size={16} className="text-nh-muted" />
        </button>
      )}
    </div>
  );
}

function OrderRow({ order, onOpen }: { order: NoxOrder; onOpen: () => void }) {
  const locale = useLocale();
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-3.5 text-left">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-nh-ink-soft text-white">
        <ReceiptText size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold">{order.orderNumber}</span>
        <span className="block text-xs text-nh-muted">{tanggal(order.createdAt, locale)}</span>
      </span>
      <span className="shrink-0 text-right text-sm font-bold tabular-nums">
        Rp {angka(order.totalIdr)}
        {order.unit === "ark" && (
          <span className="block text-[11px] font-semibold text-nh-muted">{angka(order.totalAmount)} ARK</span>
        )}
      </span>
    </button>
  );
}

type Tile = { icon: LucideIcon; label: string; onClick: () => void; brand?: boolean };

function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map(({ icon: Icon, label, onClick, brand }) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          className="nh-card flex items-center gap-3 !p-4 text-left active:scale-[0.98]"
        >
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
              brand ? "nh-surface-brand text-nh-ink" : "bg-nh-ink-soft text-white"
            }`}
          >
            <Icon size={19} strokeWidth={2.2} />
          </span>
          <span className="text-sm leading-tight font-bold">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function HomeScreen({ member, orders, goTab, openSheet }: ScreenProps) {
  const t = useT();
  const firstName = (member.profile.name ?? "Member").split(" ")[0];
  const next = member.nextTier;
  const xpPct = next && next.minLifetimeXp > 0 ? Math.min(100, (member.totalXp / next.minLifetimeXp) * 100) : 100;

  const trainTiles: Tile[] = [
    { icon: CalendarDays, label: t("Booking kelas"), onClick: () => goTab("classes"), brand: true },
    { icon: CalendarCheck, label: t("Kelas saya"), onClick: () => goTab("my-classes") },
    { icon: Ticket, label: t("Kredit kelas"), onClick: () => goTab("credits") },
    { icon: Timer, label: t("Workout HYROX"), onClick: () => goTab("workout") },
    { icon: Trophy, label: t("Race"), onClick: () => goTab("races") },
    { icon: Users, label: t("Coach"), onClick: () => goTab("coaches") },
  ];
  const memberTiles: Tile[] = [
    { icon: IdCard, label: t("Kartu member"), onClick: () => openSheet({ type: "card" }) },
    { icon: Coins, label: "ARK Coin", onClick: () => goTab("coins") },
    { icon: TicketPercent, label: t("Promo"), onClick: () => goTab("promos") },
    { icon: Gift, label: t("Reward"), onClick: () => goTab("rewards") },
    { icon: Dumbbell, label: t("Event"), onClick: () => goTab("events") },
    { icon: Flag, label: t("Challenge"), onClick: () => goTab("challenges") },
    { icon: Award, label: t("Badge"), onClick: () => goTab("badges") },
    { icon: Sparkles, label: t("Koleksi"), onClick: () => goTab("collection") },
  ];

  return (
    <div className="flex flex-col gap-8 pt-2">
      <div>
        <p className="text-sm font-semibold text-nh-muted">{t("Halo,")}</p>
        <h1 className="nh-display text-3xl leading-tight">{firstName}</h1>
      </div>

      <BalanceCard member={member} onOpen={() => openSheet({ type: "card" })} onTopup={() => goTab("topup")} />

      <section>
        <SectionHeader label={t("Latihan")} />
        <TileGrid tiles={trainTiles} />
      </section>

      <section>
        <SectionHeader label={t("Member")} />
        <TileGrid tiles={memberTiles} />
      </section>

      <PromoRail onOpen={(code) => openSheet({ type: "promo", code })} onSeeAll={() => goTab("promos")} />
      <UpcomingEvents onSeeAll={() => goTab("events")} />
      <ChallengeHighlights onSeeAll={() => goTab("challenges")} />

      <section>
        <SectionHeader label={t("Tier member")} />
        <button
          type="button"
          onClick={() => openSheet({ type: "tier" })}
          className="nh-card block w-full text-left active:scale-[0.99]"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="nh-display text-2xl">{member.tier?.name ?? "Member"}</p>
            <p className="text-sm font-bold tabular-nums">{angka(member.totalXp)} XP</p>
          </div>
          <div className="mt-3">
            <ProgressBar pct={xpPct} label={t("Progres menuju tier berikutnya")} />
          </div>
          <p className="mt-2 text-xs text-nh-muted">
            {next
              ? t("{n} XP lagi menuju {tier}", { n: angka(next.xpNeeded), tier: next.name })
              : t("Tier tertinggi sudah tercapai")}
          </p>
        </button>
      </section>

      <section>
        <SectionHeader
          label={t("Transaksi terakhir")}
          action={orders.length > 0 && <SeeAll onClick={() => goTab("history")} />}
        />
        {orders.length === 0 ? (
          <EmptyCard>{t("Belum ada transaksi. Kunjungan pertama Anda akan tercatat di sini.")}</EmptyCard>
        ) : (
          <div className="nh-card divide-y divide-nh-line !py-0">
            {orders.slice(0, 3).map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                onOpen={() => openSheet({ type: "order", id: order.id, nomor: order.orderNumber })}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function CoinsScreen({ member, wallet, goTab }: ScreenProps) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-5">
      <ScreenTitle>ARK Coin</ScreenTitle>
      <BalanceCard member={member} onTopup={() => goTab("topup")} />
      <button type="button" onClick={() => goTab("topup")} className="nh-btn-brand w-full">
        <Coins size={17} /> {t("Top-up sekarang")}
      </button>
      <p className="rounded-2xl bg-nh-lime-soft px-4 py-3 text-sm font-semibold text-nh-forest">
        {t("Top-up juga bisa di kasir mana pun. Saldo berlaku di seluruh venue.")}
      </p>
      <section>
        <SectionHeader label={t("Riwayat koin")} />
        {wallet.length === 0 ? (
          <EmptyCard>{t("Belum ada transaksi koin. Top-up pertama Anda akan tampil di sini.")}</EmptyCard>
        ) : (
          <div className="flex flex-col gap-2">
            {wallet.map((txn) => {
              // adjustment/reversal bisa dua arah: tanda amount yang menentukan.
              const kredit = isCreditEntry(txn.type, txn.amount);
              return (
                <div key={txn.id} className="nh-card flex items-center justify-between gap-3 !p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{t(TXN_LABELS[txn.type] ?? txn.type)}</p>
                    <p className="text-xs text-nh-muted">{tanggal(txn.createdAt, locale)}</p>
                  </div>
                  {/* Math.abs: amount debit sudah negatif dari API. */}
                  <span
                    className={`nh-display text-xl font-black tabular-nums ${kredit ? "text-nh-ok" : "text-nh-danger"}`}
                  >
                    {kredit ? "+" : "−"}
                    {angka(Math.abs(txn.amount))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function HistoryScreen({ orders, openSheet }: ScreenProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-5">
      <ScreenTitle>{t("Riwayat")}</ScreenTitle>
      {orders.length === 0 ? (
        <EmptyCard>{t("Belum ada transaksi. Kunjungan pertama Anda akan tercatat di sini.")}</EmptyCard>
      ) : (
        <div className="nh-card divide-y divide-nh-line !py-0">
          {orders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              onOpen={() => openSheet({ type: "order", id: order.id, nomor: order.orderNumber })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
