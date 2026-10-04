"use client";

// EPIC-028 B2 — beli Season Pass online (publik, tanpa login): pilih produk
// pass → isi data pemegang → invoice Xendit → redirect. Aktif saat webhook PAID.

import { useState } from "react";
import { ArrowLeft, CalendarCheck, Loader2, ShieldCheck } from "lucide-react";
import { formatRupiah } from "@/lib/format";
import { useCreatePass, usePassCatalog } from "./queries";
import { PUBLIC_ENTRY_LABEL } from "./types";

export function PassPurchase({ slug }: { slug: string }) {
  const catalog = usePassCatalog(slug);
  const createPass = useCreatePass(slug);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [holderName, setHolderName] = useState("");
  const [holderPhone, setHolderPhone] = useState("");

  const venueName = catalog.data?.venueName ?? "";
  const passes = catalog.data?.passes ?? [];
  const selected = passes.find((p) => p.ticket_product_id === selectedId) ?? null;
  const loading = catalog.isPending;
  // Tetap "memproses" setelah sukses sampai browser pindah ke invoice
  const submitting = createPass.isPending || createPass.isSuccess;
  const error =
    createPass.error?.message ??
    catalog.error?.message ??
    (catalog.isSuccess && passes.length === 0
      ? "Belum ada Season Pass dijual online untuk venue ini"
      : null);

  const phoneDigits = holderPhone.replace(/\D/g, "");
  const canPay = selected && holderName.trim().length >= 2 && phoneDigits.length >= 8;

  const submit = () => {
    if (!canPay || submitting) return;
    createPass.mutate({
      ticket_product_id: selected.ticket_product_id,
      holder_name: holderName.trim(),
      holder_phone: holderPhone.trim(),
    });
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-white md:max-w-2xl">
      <header className="sticky top-0 z-10 bg-white/95 px-5 pt-4 pb-3 backdrop-blur">
        <div className="flex h-9 items-center">
          {selected && (
            <button
              type="button"
              aria-label="Kembali"
              onClick={() => setSelectedId(null)}
              className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-gray-800 hover:bg-gray-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <span className="ml-auto rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            Season Pass
          </span>
        </div>
      </header>

      <main className="flex-1 px-5 pb-32 pt-2">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-gray-900">
          {selected ? "Data pemegang pass" : `Season Pass ${venueName}`.trim()}
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          {selected
            ? "Pass akan aktif otomatis setelah pembayaran berhasil."
            : "Sekali beli, masuk berkali-kali selama masa berlaku."}
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : !selected ? (
          <section className="mt-6 space-y-4">
            {passes.map((p) => (
              <button
                key={p.ticket_product_id}
                type="button"
                onClick={() => setSelectedId(p.ticket_product_id)}
                className="w-full rounded-3xl border border-gray-200 p-4 text-left transition-all hover:border-emerald-500 hover:shadow-[0_6px_16px_rgba(16,185,129,0.12)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[15px] font-semibold text-gray-900">
                    {p.name}
                  </h3>
                  <span className="shrink-0 text-[15px] font-bold text-emerald-600">
                    {formatRupiah(p.unit_price)}
                  </span>
                </div>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                    {p.description}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
                    <CalendarCheck className="h-3.5 w-3.5 text-emerald-500" />
                    Berlaku {p.validity_months} bulan
                  </span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
                    {PUBLIC_ENTRY_LABEL[p.entry_policy] ?? p.entry_policy}
                    {p.entry_policy === "limited_visits" && ` (${p.visit_quota}×)`}
                  </span>
                </div>
              </button>
            ))}
          </section>
        ) : (
          <section className="mt-6 space-y-5">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-900">{selected.name}</span>
                <span className="font-bold text-emerald-600">
                  {formatRupiah(selected.unit_price)}
                </span>
              </div>
              <p className="mt-1 text-xs text-emerald-800/80">
                Berlaku {selected.validity_months} bulan sejak pembayaran ·{" "}
                {PUBLIC_ENTRY_LABEL[selected.entry_policy] ?? selected.entry_policy}
              </p>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-gray-900">Nama lengkap</span>
              <input
                type="text"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                maxLength={120}
                placeholder="Nama pemegang pass"
                className="mt-1.5 w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-900">Nomor WhatsApp</span>
              <input
                type="tel"
                inputMode="tel"
                value={holderPhone}
                onChange={(e) => setHolderPhone(e.target.value)}
                maxLength={25}
                placeholder="08xxxxxxxxxx"
                className="mt-1.5 w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </label>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-gray-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              Kode pass & QR dikirim ke WhatsApp ini setelah pembayaran berhasil.
            </p>
          </section>
        )}
      </main>

      {selected && (
        <footer className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-lg border-t border-gray-200 bg-white px-5 py-3.5 md:max-w-2xl">
          <button
            type="button"
            onClick={submit}
            disabled={!canPay || submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Memproses…
              </>
            ) : (
              <>Bayar {formatRupiah(selected.unit_price)}</>
            )}
          </button>
        </footer>
      )}
    </div>
  );
}
