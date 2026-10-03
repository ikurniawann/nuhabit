"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Clock, QrCode } from "lucide-react";
import { angka } from "../format";
import { EmptyCard, ErrorNote, LoadingNote, SectionHeader } from "./mobile-ui";

/* ── Data ────────────────────────────────────────────────────────────── */

interface TopupPackageOption {
  id: string;
  name: string;
  description: string;
  price_idr: number;
  credit_idr: number;
  bonus_idr: number;
  validity_days: number | null;
}

interface TopupOptions {
  balance: number;
  ark_rate: number;
  min_amount: number;
  max_amount: number;
  presets: number[];
  packages: TopupPackageOption[];
  pending_id: string | null;
  can_simulate: boolean;
}

interface MemberTopup {
  id: string;
  status: "pending" | "completed" | "expired" | "failed" | "cancelled";
  amount: number;
  credit_idr: number;
  package_name: string | null;
  qr_string: string | null;
  expires_at: string | null;
  simulated: boolean;
  balance_after: number;
}

type Choice = { packageId: string } | { amount: number } | null;

async function topupApi<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Permintaan gagal");
  return json.data as T;
}

const OPTIONS_KEY = ["member-portal", "topup"];
const POLL_MS = 4_000;
/** Event untuk shell portal: saldo berubah, muat ulang data member. */
export const WALLET_UPDATED_EVENT = "nh:wallet-updated";

const rp = (n: number) => `Rp ${angka(Math.round(n))}`;

function useCountdown(expiresAt: string | null) {
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

/** Top-up mandiri: pilih paket atau nominal, bayar QRIS, saldo masuk otomatis. */
export function TopupScreen() {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: OPTIONS_KEY, queryFn: () => topupApi<TopupOptions>("/api/member-portal/topup") });
  const [choice, setChoice] = useState<Choice>(null);
  const [custom, setCustom] = useState("");
  // undefined = belum memilih: QR yang masih berlaku dari kunjungan sebelumnya dilanjutkan.
  const [chosenId, setChosenId] = useState<string | null | undefined>(undefined);
  const activeId = chosenId === undefined ? (options.data?.pending_id ?? null) : chosenId;

  const create = useMutation({
    mutationFn: (c: NonNullable<Choice>) =>
      topupApi<MemberTopup>("/api/member-portal/topup", "packageId" in c ? { package_id: c.packageId } : { amount: c.amount }),
    onSuccess: (topup) => {
      queryClient.setQueryData(["member-portal", "topup", topup.id], topup);
      setChosenId(topup.id);
    },
  });

  const reset = () => {
    setChosenId(null);
    setChoice(null);
    setCustom("");
    create.reset();
    void queryClient.invalidateQueries({ queryKey: OPTIONS_KEY });
  };

  if (activeId) return <PaymentView topupId={activeId} canSimulate={options.data?.can_simulate ?? false} onDone={reset} />;

  const data = options.data;
  const selectedPackage = choice && "packageId" in choice ? data?.packages.find((p) => p.id === choice.packageId) : null;
  const pay = selectedPackage?.price_idr ?? (choice && "amount" in choice ? choice.amount : 0);
  const credit = selectedPackage?.credit_idr ?? pay;
  const amountError =
    data && choice && "amount" in choice
      ? choice.amount < data.min_amount
        ? `Minimal ${rp(data.min_amount)}`
        : data.max_amount > 0 && choice.amount > data.max_amount
          ? `Maksimal ${rp(data.max_amount)}`
          : null
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="nh-display text-3xl font-black">Top-up ARK</h1>
        <p className="mt-1 text-sm text-nh-muted">Bayar pakai QRIS dari aplikasi bank atau e-wallet. Saldo masuk otomatis.</p>
      </div>

      {options.isLoading && <LoadingNote />}
      {options.error && <ErrorNote>{options.error.message}</ErrorNote>}

      {data && (
        <>
          <div className="nh-card nh-surface-ink !border-0 !p-5 text-white">
            <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">Saldo sekarang</p>
            <p className="nh-display mt-1 text-4xl tabular-nums">{angka(Math.floor(data.balance / Math.max(1, data.ark_rate)))} ARK</p>
            <p className="mt-1 text-xs font-semibold text-white/45">≈ {rp(data.balance)}</p>
          </div>

          {data.packages.length > 0 && (
            <section>
              <SectionHeader label="Paket" />
              <div className="flex flex-col gap-2">
                {data.packages.map((p) => {
                  const on = selectedPackage?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setChoice({ packageId: p.id });
                        setCustom("");
                      }}
                      className={`nh-card flex items-center justify-between gap-3 !p-4 text-left active:scale-[0.99] ${
                        on ? "ring-2 ring-nh-forest" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold">{p.name}</p>
                        <p className="text-xs text-nh-muted">
                          Dapat {rp(p.credit_idr)}
                          {p.validity_days ? ` · berlaku ${p.validity_days} hari` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="nh-display text-lg tabular-nums">{rp(p.price_idr)}</p>
                        {p.bonus_idr > 0 && <span className="nh-chip bg-nh-lime text-nh-ink">+{rp(p.bonus_idr)}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <SectionHeader label="Nominal bebas" />
            {data.presets.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {data.presets.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setChoice({ amount: v });
                      setCustom(angka(v));
                    }}
                    className={`nh-chip ${choice && "amount" in choice && choice.amount === v ? "bg-nh-ink text-white" : "bg-nh-raised text-nh-ink"}`}
                  >
                    {rp(v)}
                  </button>
                ))}
              </div>
            )}
            <label className="nh-label" htmlFor="topup-amount">
              Nominal (Rp)
            </label>
            <input
              id="topup-amount"
              className="nh-input"
              inputMode="numeric"
              placeholder={`Minimal ${rp(data.min_amount)}`}
              value={custom}
              onChange={(e) => {
                const digits = Number(e.target.value.replace(/\D/g, "")) || 0;
                setCustom(digits ? angka(digits) : "");
                setChoice(digits ? { amount: digits } : null);
              }}
            />
            {amountError && <p className="mt-1.5 text-xs font-semibold text-nh-danger">{amountError}</p>}
          </section>

          {data.packages.length === 0 && data.presets.length === 0 && (
            <EmptyCard>Belum ada paket. Isi nominal top-up di atas.</EmptyCard>
          )}

          {create.error && <ErrorNote>{create.error.message}</ErrorNote>}

          <div className="nh-card flex items-center justify-between gap-3 !p-4">
            <div>
              <p className="text-xs text-nh-muted">Saldo diterima</p>
              <p className="nh-display text-2xl tabular-nums">{rp(credit)}</p>
            </div>
            <button
              type="button"
              className="nh-btn-brand"
              disabled={!choice || pay <= 0 || Boolean(amountError) || create.isPending}
              onClick={() => choice && create.mutate(choice)}
            >
              <QrCode size={18} /> {create.isPending ? "Membuat QR…" : `Bayar ${rp(pay)}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PaymentView({ topupId, canSimulate, onDone }: { topupId: string; canSimulate: boolean; onDone: () => void }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["member-portal", "topup", topupId],
    queryFn: () => topupApi<MemberTopup>(`/api/member-portal/topup/${topupId}`),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? POLL_MS : false),
  });
  const simulate = useMutation({
    mutationFn: () => topupApi<MemberTopup>(`/api/member-portal/topup/${topupId}/simulate-paid`, {}),
    onSuccess: (topup) => queryClient.setQueryData(["member-portal", "topup", topupId], topup),
  });
  const topup = status.data;
  const secondsLeft = useCountdown(topup?.expires_at ?? null);
  const paid = topup?.status === "completed";

  useEffect(() => {
    if (!paid) return;
    window.dispatchEvent(new Event(WALLET_UPDATED_EVENT));
    void queryClient.invalidateQueries({ queryKey: ["member-portal"] });
  }, [paid, queryClient]);

  if (status.isLoading) return <LoadingNote />;
  if (status.error || !topup) return <ErrorNote>{status.error?.message ?? "Top-up tidak ditemukan"}</ErrorNote>;

  if (paid) {
    return (
      <div className="flex flex-col gap-5">
        <div className="nh-card nh-surface-brand !border-0 !p-6 text-nh-ink">
          <CheckCircle2 size={36} strokeWidth={2.4} />
          <p className="nh-display mt-3 text-3xl font-black">Saldo masuk</p>
          <p className="nh-display mt-1 text-5xl tabular-nums">+{rp(topup.credit_idr)}</p>
          <p className="mt-3 text-sm font-semibold">Saldo sekarang {rp(topup.balance_after)}</p>
        </div>
        <button type="button" className="nh-btn-ghost" onClick={onDone}>
          Top-up lagi
        </button>
      </div>
    );
  }

  const expired = topup.status !== "pending" || (topup.expires_at != null && secondsLeft === 0);
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="nh-display text-3xl font-black">Bayar QRIS</h1>
        <p className="mt-1 text-sm text-nh-muted">
          {topup.package_name ? `${topup.package_name} · ` : ""}Pindai dengan aplikasi bank atau e-wallet.
        </p>
      </div>

      <div className="nh-card flex flex-col items-center gap-3 !p-6">
        <p className="nh-display text-4xl tabular-nums">{rp(topup.amount)}</p>
        {topup.credit_idr > topup.amount && (
          <span className="nh-chip bg-nh-lime text-nh-ink">Saldo diterima {rp(topup.credit_idr)}</span>
        )}
        <div className={`rounded-2xl bg-white p-4 ${expired ? "opacity-30" : ""}`}>
          {topup.qr_string ? (
            <QRCodeSVG value={topup.qr_string} size={220} level="M" marginSize={0} />
          ) : (
            <div className="flex size-[220px] items-center justify-center text-xs text-nh-muted">QR tidak tersedia</div>
          )}
        </div>
        {expired ? (
          <p className="text-sm font-bold text-nh-danger">QR sudah kedaluwarsa. Buat QR baru untuk membayar.</p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm font-bold text-nh-muted">
            <Clock size={15} /> Menunggu pembayaran · {mm}:{ss}
          </p>
        )}
        {topup.simulated && <p className="text-center text-xs text-nh-muted">Mode uji lokal: QR ini bukan QRIS sungguhan.</p>}
      </div>

      {canSimulate && !expired && (
        <button type="button" className="nh-btn-ghost" disabled={simulate.isPending} onClick={() => simulate.mutate()}>
          Simulasikan sudah bayar (dev)
        </button>
      )}
      {simulate.error && <ErrorNote>{simulate.error.message}</ErrorNote>}

      <button type="button" className={expired ? "nh-btn-brand" : "nh-btn-ghost"} onClick={onDone}>
        {expired ? "Buat QR baru" : "Pilih nominal lain"}
      </button>
    </div>
  );
}
