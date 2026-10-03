"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  Gift,
  History,
  Home,
  Info,
  LogOut,
  Loader2,
  Plus,
  ShoppingBag,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { MemberLoginCard } from "./member-login-card";
import { MemberProfileCard } from "./member-profile-card";
import { MemberCollectionCard } from "./member-collection-card";
import { MemberExtrasCard } from "./member-extras-card";
import { MemberRewardsCard } from "./member-rewards-card";
import { MemberWalletCard } from "./member-wallet-card";

/** Bentuk respons GET /api/member-portal/me */
export interface MemberMe {
  profile: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    birth_date: string | null;
    gender: string | null;
    city: string | null;
    photo_url: string | null;
    wa_consent: boolean | null;
  };
  member_type: "registered" | "card";
  ark_coin_balance: number;
  total_xp: number;
  visit_count: number;
  tier: { code: string; name: string; discount_percent: number } | null;
  next_tier: { name: string; min_lifetime_xp: number; xp_needed: number } | null;
  completion: { percent: number; complete: boolean; missing_labels: string[] };
  free_xp_granted: boolean;
  free_xp_amount: number;
}

interface WalletRow {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  notes: string | null;
  created_at: string;
}
interface OrderRow {
  id: string;
  order_number: string | null;
  total_amount: number;
  payment_method: string | null;
  status: string;
  created_at: string;
}

const rupiah = (value: number) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const WALLET_LABELS: Record<string, string> = {
  topup: "Topup",
  topup_bonus: "Bonus Topup",
  payment: "Pembayaran",
  purchase: "Pembayaran",
};

const TABS = [
  ["beranda", "Beranda", Home],
  ["rewards", "Reward", Gift],
  ["koleksi", "Koleksi", Sparkles],
  ["profil", "Profil", UserRound],
  ["riwayat", "Riwayat", History],
] as const;

type TabKey = (typeof TABS)[number][0];

export function MemberPortalPage() {
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<MemberMe | null>(null);
  const [transactions, setTransactions] = useState<{
    wallet: WalletRow[];
    orders: OrderRow[];
  } | null>(null);
  const [tab, setTab] = useState<TabKey>("beranda");
  const [topupInfoOpen, setTopupInfoOpen] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch("/api/member-portal/me");
      if (!res.ok) {
        setMe(null);
        return;
      }
      const json = await res.json();
      setMe(json.data);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (!me || tab !== "riwayat" || transactions) return;
    fetch("/api/member-portal/transactions")
      .then((res) => res.json())
      .then((json) => setTransactions(json.data ?? { wallet: [], orders: [] }))
      .catch(() => setTransactions({ wallet: [], orders: [] }));
  }, [me, tab, transactions]);

  async function logout() {
    await fetch("/api/member-portal/logout", { method: "POST" });
    setMe(null);
    setTransactions(null);
    setTab("beranda");
  }

  if (checking) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-8 animate-spin" style={{ color: "var(--brand-primary)" }} />
      </div>
    );
  }

  if (!me) {
    return <MemberLoginCard onSuccess={loadMe} />;
  }

  const namaDepan = me.profile.name?.split(" ")[0] ?? "Member";

  return (
    <div className="space-y-5">
      <header className="mp-rise flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Image
            src="/member-assets/icons/icon-192.png"
            alt="NüHabit"
            width={40}
            height={40}
            className="size-10 object-contain"
            priority
          />
          <div>
            <p className="mp-label" style={{ color: "var(--brand-primary)" }}>
              Portal Member
            </p>
            <h1 className="text-lg font-bold leading-tight" style={{ color: "var(--mp-ink)" }}>
              Halo, {namaDepan}
            </h1>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          aria-label="Keluar"
          className="grid size-9 place-items-center rounded-full bg-white/70 text-[color:var(--mp-ink-soft)] shadow-sm ring-1 ring-black/5 transition hover:bg-white"
        >
          <LogOut className="size-4" />
        </button>
      </header>

      <MemberWalletCard me={me} />

      <QuickActions
        memberType={me.member_type}
        topupInfoOpen={topupInfoOpen}
        onToggleTopupInfo={() => setTopupInfoOpen((current) => !current)}
        onGoRewards={() => setTab("rewards")}
      />

      {!me.free_xp_granted && me.free_xp_amount > 0 && (
        <button
          onClick={() => setTab("profil")}
          className="mp-rise mp-rise-3 flex w-full items-center gap-3 rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-white px-4 py-3 text-left shadow-sm transition hover:shadow-md"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-100">
            <Sparkles className="size-4 text-amber-600" />
          </span>
          <span className="text-sm text-amber-900">
            Lengkapi profil ({me.completion.percent}%) dan dapatkan{" "}
            <strong className="font-bold">{me.free_xp_amount} Free XP</strong>
          </span>
        </button>
      )}

      {/* Tab bar segmented — pil aktif berwarna brand, bukan abu-abu datar. */}
      <nav className="mp-rise mp-rise-3 grid grid-cols-5 gap-1 rounded-2xl bg-white/70 p-1 shadow-sm ring-1 ring-black/5 backdrop-blur">
        {TABS.map(([value, label, Icon]) => {
          const active = tab === value;
          return (
            <button
              key={value}
              onClick={() => setTab(value)}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold transition ${
                active ? "text-white shadow-sm" : "text-[color:var(--mp-ink-soft)] hover:bg-black/5"
              }`}
              style={active ? { backgroundColor: "var(--brand-primary)" } : undefined}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="mp-rise mp-rise-3">
        {tab === "beranda" && <BerandaTab me={me} />}
        {tab === "rewards" && <MemberRewardsCard onRedeemed={loadMe} />}
        {tab === "koleksi" && (
          <div className="space-y-4">
            <MemberCollectionCard onEquipped={loadMe} />
            <MemberExtrasCard />
          </div>
        )}
        {tab === "profil" && <MemberProfileCard me={me} onSaved={loadMe} />}
        {tab === "riwayat" && <RiwayatTab transactions={transactions} />}
      </div>

      <p className="pt-2 text-center text-[11px] text-[color:var(--mp-ink-soft)]">
        NüHabit · Portal Member
      </p>
    </div>
  );
}

/**
 * Aksi cepat di bawah kartu. Topup TIDAK dilayani portal (hanya kasir, dan
 * khusus member kartu) — jadi tombolnya memandu, bukan menjanjikan fitur yang
 * tidak ada.
 */
function QuickActions({
  memberType,
  topupInfoOpen,
  onToggleTopupInfo,
  onGoRewards,
}: {
  memberType: MemberMe["member_type"];
  topupInfoOpen: boolean;
  onToggleTopupInfo: () => void;
  onGoRewards: () => void;
}) {
  return (
    <div className="mp-rise mp-rise-2 space-y-2">
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onToggleTopupInfo}
          aria-expanded={topupInfoOpen}
          className="flex items-center gap-2.5 rounded-2xl bg-white/85 px-3.5 py-3 text-left shadow-sm ring-1 ring-black/5 backdrop-blur transition active:scale-[0.98] hover:shadow-md"
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl text-white"
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            <Plus className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold" style={{ color: "var(--mp-ink)" }}>
              Topup
            </span>
            <span className="block text-[11px] text-[color:var(--mp-ink-soft)]">Isi ARK Coin</span>
          </span>
        </button>

        <button
          type="button"
          onClick={onGoRewards}
          className="flex items-center gap-2.5 rounded-2xl bg-white/85 px-3.5 py-3 text-left shadow-sm ring-1 ring-black/5 backdrop-blur transition active:scale-[0.98] hover:shadow-md"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-400 text-amber-950">
            <Gift className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold" style={{ color: "var(--mp-ink)" }}>
              Tukar Reward
            </span>
            <span className="block text-[11px] text-[color:var(--mp-ink-soft)]">Pakai XP kamu</span>
          </span>
        </button>
      </div>

      {topupInfoOpen && (
        <div className="rounded-2xl border border-[color:var(--mp-line)] bg-white/90 p-4 shadow-sm backdrop-blur">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 size-4 shrink-0" style={{ color: "var(--brand-primary)" }} />
            <div className="min-w-0 flex-1 text-sm leading-relaxed text-[color:var(--mp-ink-soft)]">
              {memberType === "card" ? (
                <>
                  <p className="font-semibold" style={{ color: "var(--mp-ink)" }}>
                    Topup dilakukan di kasir
                  </p>
                  <p className="mt-1">
                    Tunjukkan kartu member Anda ke kasir venue kami untuk mengisi saldo
                    ARK Coin. Saldo langsung bertambah dan bisa dipakai saat itu juga.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold" style={{ color: "var(--mp-ink)" }}>
                    Tautkan kartu member dulu
                  </p>
                  <p className="mt-1">
                    Topup ARK Coin hanya untuk member kartu. Minta kasir menautkan kartu
                    member ke akun Anda — setelah itu Anda bisa topup dan mengumpulkan XP
                    dari setiap transaksi.
                  </p>
                </>
              )}
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs">
                <CreditCard className="size-3.5" />
                Saldo ARK Coin tidak dapat diuangkan kembali.
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleTopupInfo}
              aria-label="Tutup"
              className="grid size-6 shrink-0 place-items-center rounded-full text-[color:var(--mp-ink-soft)] transition hover:bg-black/5"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BerandaTab({ me }: { me: MemberMe }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Tipe Member"
          value={me.member_type === "card" ? "Kartu" : "Terdaftar"}
          hint={me.member_type === "card" ? "Bisa topup ARK" : "Belum bisa topup"}
        />
        <StatTile
          label="Kunjungan"
          value={`${me.visit_count}×`}
          hint="Total kunjungan tercatat"
        />
      </div>

      {me.member_type !== "card" && (
        <div className="rounded-2xl border border-dashed border-[color:var(--mp-line)] bg-white/60 px-4 py-3 text-xs leading-relaxed text-[color:var(--mp-ink-soft)]">
          Tautkan kartu member di kasir untuk bisa topup ARK Coin dan
          mengumpulkan XP dari setiap transaksi.
        </div>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-black/5">
      <p className="mp-label text-[color:var(--mp-ink-soft)]">{label}</p>
      <p className="mp-figure mt-1.5 text-xl font-bold" style={{ color: "var(--mp-ink)" }}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-[color:var(--mp-ink-soft)]">{hint}</p>
    </div>
  );
}

function RiwayatTab({
  transactions,
}: {
  transactions: { wallet: WalletRow[]; orders: OrderRow[] } | null;
}) {
  if (!transactions) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-[color:var(--mp-ink-soft)]" />
      </div>
    );
  }

  const kosong = transactions.wallet.length === 0 && transactions.orders.length === 0;
  if (kosong) {
    return (
      <div className="rounded-2xl bg-white/70 py-10 text-center text-sm text-[color:var(--mp-ink-soft)] ring-1 ring-black/5">
        Belum ada transaksi.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {transactions.wallet.length > 0 && (
        <section className="space-y-2">
          <h2 className="mp-label px-1 text-[color:var(--mp-ink-soft)]">ARK Coin</h2>
          <div className="overflow-hidden rounded-2xl bg-white/80 shadow-sm ring-1 ring-black/5">
            {transactions.wallet.map((row, index) => {
              const masuk = row.type.startsWith("topup");
              return (
                <div
                  key={row.id}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    index > 0 ? "border-t border-black/5" : ""
                  }`}
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-full ${
                      masuk ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"
                    }`}
                  >
                    {masuk ? (
                      <ArrowDownLeft className="size-4" />
                    ) : (
                      <ArrowUpRight className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" style={{ color: "var(--mp-ink)" }}>
                      {WALLET_LABELS[row.type] ?? row.type}
                    </p>
                    <p className="text-[11px] text-[color:var(--mp-ink-soft)]">
                      {tanggal(row.created_at)}
                    </p>
                  </div>
                  <p
                    className={`mp-figure shrink-0 text-sm font-bold ${
                      masuk ? "text-emerald-600" : "text-[color:var(--mp-ink)]"
                    }`}
                  >
                    {masuk ? "+" : "−"}
                    {rupiah(Math.abs(row.amount))}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {transactions.orders.length > 0 && (
        <section className="space-y-2">
          <h2 className="mp-label px-1 text-[color:var(--mp-ink-soft)]">Pembelian</h2>
          <div className="overflow-hidden rounded-2xl bg-white/80 shadow-sm ring-1 ring-black/5">
            {transactions.orders.map((order, index) => (
              <div
                key={order.id}
                className={`flex items-center gap-3 px-4 py-3 ${
                  index > 0 ? "border-t border-black/5" : ""
                }`}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--mp-line)] text-[color:var(--brand-primary)]">
                  <ShoppingBag className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--mp-ink)" }}>
                    {order.order_number ?? order.id.slice(0, 8)}
                  </p>
                  <p className="text-[11px] text-[color:var(--mp-ink-soft)]">
                    {tanggal(order.created_at)}
                    {order.payment_method ? ` · ${order.payment_method.replace("_", " ")}` : ""}
                  </p>
                </div>
                <p className="mp-figure shrink-0 text-sm font-bold" style={{ color: "var(--mp-ink)" }}>
                  {rupiah(order.total_amount)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
