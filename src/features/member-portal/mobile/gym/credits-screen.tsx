"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { CalendarClock, CheckCircle2, Clock, Coins, QrCode, Ticket } from "lucide-react";
import { angka, tanggalPendek } from "../../format";
import { memberApi, postJson } from "../mobile-api";
import { EmptyCard, ErrorNote, LoadingNote, SectionHeader } from "../mobile-ui";

/* ── Data ────────────────────────────────────────────────────────────── */

type EntryType = "top_up" | "class_deduction" | "refund" | "bonus" | "expiration" | "adjustment" | "reversal";

interface CreditLot {
  id: string;
  package_name: string | null;
  credits: number;
  remaining: number;
  expires_at: string;
}

interface CreditWallet {
  balance: number;
  expiring_credits: number;
  expiry_reminder_days: number;
  low_balance: boolean;
  lots: CreditLot[];
  expiring_lots: CreditLot[];
  entries: { id: string; type: EntryType; amount: number; note: string | null; reversed: boolean; created_at: string }[];
}

interface PackageOption {
  id: string;
  name: string;
  description: string;
  credits: number;
  price_idr: number;
  validity_days: number;
  restricted: boolean;
  can_buy: boolean;
  blocked_reason: string | null;
}

interface PackageCatalog {
  packages: PackageOption[];
  ark_enabled: boolean;
  ark_balance_idr: number;
  ark_rate: number;
  can_simulate: boolean;
}

interface Purchase {
  id: string;
  status: "pending" | "paid" | "failed" | "expired" | "refunded";
  package_name: string;
  credits: number;
  total_idr: number;
  qr_string: string | null;
  expires_at: string | null;
  simulated: boolean;
}

type PayMethod = "qris" | "ark_coin";

const WALLET_KEY = ["member-portal", "gym-credits"];
const CATALOG_KEY = ["member-portal", "gym-credits", "packages"];
const purchaseKey = (id: string) => ["member-portal", "gym-credits", "purchase", id];
const POLL_MS = 4_000;

const ENTRY_LABELS: Record<EntryType, string> = {
  top_up: "Beli paket",
  class_deduction: "Booking kelas",
  refund: "Kredit kembali",
  bonus: "Bonus",
  expiration: "Kedaluwarsa",
  adjustment: "Penyesuaian",
  reversal: "Koreksi",
};

const rp = (n: number) => `Rp ${angka(Math.round(n))}`;

function useSecondsLeft(expiresAt: string | null) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

/* ── Layar ───────────────────────────────────────────────────────────── */

/**
 * Kredit kelas gym: saldo, kredit yang segera hangus, beli paket (QRIS atau
 * ARK Coin), dan riwayat. `onBookClass` (opsional) menampilkan tombol ke jadwal kelas.
 */
export function GymCreditsScreen({ onBookClass }: { onBookClass?: () => void }) {
  const wallet = useQuery({ queryKey: WALLET_KEY, queryFn: () => memberApi<CreditWallet>("/api/member-portal/gym/credits") });
  const [purchaseId, setPurchaseId] = useState<string | null>(null);

  if (purchaseId) return <PaymentView purchaseId={purchaseId} onDone={() => setPurchaseId(null)} />;

  const data = wallet.data;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="nh-display text-3xl font-black">Kredit kelas</h1>
        <p className="mt-1 text-sm text-nh-muted">Satu kredit untuk satu kelas. Kredit yang paling cepat hangus dipakai lebih dulu.</p>
      </div>

      {wallet.isLoading && <LoadingNote />}
      {wallet.error && <ErrorNote>{wallet.error.message}</ErrorNote>}

      {data && (
        <>
          <div className="nh-card nh-surface-ink !border-0 !p-5 text-white">
            <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">Saldo kredit</p>
            <p className="nh-display mt-1 text-5xl tabular-nums">{angka(data.balance)}</p>
            <p className="mt-1 text-xs font-semibold text-white/55">
              {data.low_balance ? "Saldo menipis. Beli paket supaya tetap bisa booking." : "Siap dipakai untuk booking kelas."}
            </p>
            {onBookClass && data.balance > 0 && (
              <button type="button" className="nh-btn-brand mt-4" onClick={onBookClass}>
                <Ticket size={18} /> Booking kelas
              </button>
            )}
          </div>

          {data.expiring_lots.length > 0 && (
            <section>
              <SectionHeader label={`Hangus dalam ${data.expiry_reminder_days} hari`} />
              <div className="flex flex-col gap-2">
                {data.expiring_lots.map((lot) => (
                  <div key={lot.id} className="nh-card flex items-center justify-between gap-3 !p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <CalendarClock size={20} className="shrink-0 text-nh-warn" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold">{lot.package_name ?? "Kredit bonus"}</p>
                        <p className="text-xs text-nh-muted">Berlaku sampai {tanggalPendek(lot.expires_at)}</p>
                      </div>
                    </div>
                    <span className="nh-chip shrink-0 bg-nh-lime-soft text-nh-forest">{angka(lot.remaining)} kredit</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <PackagePicker onPending={setPurchaseId} />

          <section>
            <SectionHeader label="Kredit aktif" />
            {data.lots.length === 0 ? (
              <EmptyCard>Belum ada kredit aktif.</EmptyCard>
            ) : (
              <div className="nh-card !p-0">
                {data.lots.map((lot) => (
                  <div key={lot.id} className="flex items-center justify-between gap-3 border-b border-nh-line px-4 py-3 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{lot.package_name ?? "Kredit bonus"}</p>
                      <p className="text-xs text-nh-muted">Sampai {tanggalPendek(lot.expires_at)}</p>
                    </div>
                    <p className="shrink-0 text-sm font-extrabold tabular-nums">
                      {angka(lot.remaining)}
                      <span className="font-semibold text-nh-muted"> / {angka(lot.credits)}</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeader label="Riwayat" />
            {data.entries.length === 0 ? (
              <EmptyCard>Belum ada riwayat kredit.</EmptyCard>
            ) : (
              <div className="nh-card !p-0">
                {data.entries.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 border-b border-nh-line px-4 py-3 last:border-0">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-bold ${e.reversed ? "line-through opacity-60" : ""}`}>{ENTRY_LABELS[e.type]}</p>
                      <p className="truncate text-xs text-nh-muted">
                        {[e.note, tanggalPendek(e.created_at)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <p className={`shrink-0 text-sm font-extrabold tabular-nums ${e.amount > 0 ? "text-nh-ok" : "text-nh-danger"}`}>
                      {e.amount > 0 ? "+" : ""}
                      {angka(e.amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function PackagePicker({ onPending }: { onPending: (purchaseId: string) => void }) {
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: CATALOG_KEY, queryFn: () => memberApi<PackageCatalog>("/api/member-portal/gym/credits/packages") });
  const [selected, setSelected] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>("qris");

  const buy = useMutation({
    mutationFn: (input: { package_id: string; method: PayMethod }) =>
      postJson<Purchase>("/api/member-portal/gym/credits/purchases", input),
    onSuccess: (purchase) => {
      queryClient.setQueryData(purchaseKey(purchase.id), purchase);
      if (purchase.status === "paid") {
        void queryClient.invalidateQueries({ queryKey: ["member-portal"] });
        setSelected(null);
      } else {
        onPending(purchase.id);
      }
    },
  });

  const data = catalog.data;
  const pkg = data?.packages.find((p) => p.id === selected) ?? null;
  const arkShort = method === "ark_coin" && pkg !== null && (data?.ark_balance_idr ?? 0) < pkg.price_idr;

  return (
    <section>
      <SectionHeader label="Beli paket" />
      {catalog.isLoading && <LoadingNote />}
      {catalog.error && <ErrorNote>{catalog.error.message}</ErrorNote>}
      {data && data.packages.length === 0 && <EmptyCard>Belum ada paket yang dijual.</EmptyCard>}
      {data && data.packages.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.packages.map((p) => {
            const on = selected === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={!p.can_buy}
                onClick={() => setSelected(on ? null : p.id)}
                className={`nh-card flex items-center justify-between gap-3 !p-4 text-left active:scale-[0.99] disabled:opacity-50 ${
                  on ? "ring-2 ring-nh-forest" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-extrabold">{p.name}</p>
                  <p className="text-xs text-nh-muted">
                    {p.blocked_reason ??
                      `${angka(p.credits)} kredit · berlaku ${p.validity_days} hari${p.restricted ? " · kelas tertentu" : ""}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="nh-display text-lg tabular-nums">{rp(p.price_idr)}</p>
                  <p className="text-[11px] font-semibold text-nh-muted">{rp(p.price_idr / p.credits)}/kelas</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {pkg && data && (
        <div className="nh-card mt-3 flex flex-col gap-3 !p-4">
          {data.ark_enabled && (
            <div className="flex gap-2" role="radiogroup" aria-label="Metode bayar">
              {(
                [
                  ["qris", "QRIS", <QrCode key="q" size={16} />],
                  ["ark_coin", "Saldo ARK", <Coins key="a" size={16} />],
                ] as const
              ).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={method === value}
                  onClick={() => setMethod(value)}
                  className={`nh-chip inline-flex items-center gap-1.5 ${method === value ? "bg-nh-ink text-white" : "bg-nh-raised text-nh-ink"}`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          )}
          {method === "ark_coin" && (
            <p className={`text-xs font-semibold ${arkShort ? "text-nh-danger" : "text-nh-muted"}`}>
              Saldo ARK {rp(data.ark_balance_idr)}
              {arkShort ? " · tidak cukup, pakai QRIS atau top-up dulu" : ""}
            </p>
          )}
          {buy.error && <ErrorNote>{buy.error.message}</ErrorNote>}
          <button
            type="button"
            className="nh-btn-brand"
            disabled={buy.isPending || arkShort}
            onClick={() => buy.mutate({ package_id: pkg.id, method: data.ark_enabled ? method : "qris" })}
          >
            {buy.isPending ? "Memproses…" : `Bayar ${rp(pkg.price_idr)}`}
          </button>
          {buy.data?.status === "paid" && <p className="text-center text-sm font-bold text-nh-forest">Kredit sudah masuk.</p>}
        </div>
      )}
    </section>
  );
}

function PaymentView({ purchaseId, onDone }: { purchaseId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: purchaseKey(purchaseId),
    queryFn: () => memberApi<Purchase>(`/api/member-portal/gym/credits/purchases/${purchaseId}`),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? POLL_MS : false),
  });
  const canSimulate = queryClient.getQueryData<PackageCatalog>(CATALOG_KEY)?.can_simulate ?? false;
  const simulate = useMutation({
    mutationFn: () => postJson<Purchase>(`/api/member-portal/gym/credits/purchases/${purchaseId}/simulate-paid`, {}),
    onSuccess: (purchase) => queryClient.setQueryData(purchaseKey(purchaseId), purchase),
  });
  const purchase = status.data;
  const secondsLeft = useSecondsLeft(purchase?.expires_at ?? null);
  const paid = purchase?.status === "paid";

  useEffect(() => {
    if (paid) void queryClient.invalidateQueries({ queryKey: ["member-portal"] });
  }, [paid, queryClient]);

  if (status.isLoading) return <LoadingNote />;
  if (status.error || !purchase) return <ErrorNote>{status.error?.message ?? "Pembelian tidak ditemukan"}</ErrorNote>;

  if (paid) {
    return (
      <div className="flex flex-col gap-5">
        <div className="nh-card nh-surface-brand !border-0 !p-6 text-nh-ink">
          <CheckCircle2 size={36} strokeWidth={2.4} />
          <p className="nh-display mt-3 text-3xl font-black">Kredit masuk</p>
          <p className="nh-display mt-1 text-5xl tabular-nums">+{angka(purchase.credits)}</p>
          <p className="mt-3 text-sm font-semibold">{purchase.package_name}</p>
        </div>
        <button type="button" className="nh-btn-ghost" onClick={onDone}>
          Kembali ke kredit
        </button>
      </div>
    );
  }

  const expired = purchase.status !== "pending" || (purchase.expires_at !== null && secondsLeft === 0);
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="nh-display text-3xl font-black">Bayar QRIS</h1>
        <p className="mt-1 text-sm text-nh-muted">{purchase.package_name} · pindai dengan aplikasi bank atau e-wallet.</p>
      </div>
      <div className="nh-card flex flex-col items-center gap-3 !p-6">
        <p className="nh-display text-4xl tabular-nums">{rp(purchase.total_idr)}</p>
        <span className="nh-chip bg-nh-lime text-nh-ink">{angka(purchase.credits)} kredit</span>
        <div className={`rounded-2xl bg-white p-4 ${expired ? "opacity-30" : ""}`}>
          {purchase.qr_string ? (
            <QRCodeSVG value={purchase.qr_string} size={220} level="M" marginSize={0} />
          ) : (
            <div className="flex size-[220px] items-center justify-center text-xs text-nh-muted">QR tidak tersedia</div>
          )}
        </div>
        {expired ? (
          <p className="text-sm font-bold text-nh-danger">QR sudah kedaluwarsa. Pilih paket lagi untuk membuat QR baru.</p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm font-bold text-nh-muted">
            <Clock size={15} /> Menunggu pembayaran · {mm}:{ss}
          </p>
        )}
        {purchase.simulated && <p className="text-center text-xs text-nh-muted">Mode uji lokal: QR ini bukan QRIS sungguhan.</p>}
      </div>
      {canSimulate && !expired && (
        <button type="button" className="nh-btn-ghost" disabled={simulate.isPending} onClick={() => simulate.mutate()}>
          Simulasikan sudah bayar (dev)
        </button>
      )}
      {simulate.error && <ErrorNote>{simulate.error.message}</ErrorNote>}
      <button type="button" className={expired ? "nh-btn-brand" : "nh-btn-ghost"} onClick={onDone}>
        {expired ? "Pilih paket lagi" : "Kembali"}
      </button>
    </div>
  );
}
