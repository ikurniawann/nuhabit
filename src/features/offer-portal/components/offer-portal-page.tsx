"use client";

import { AlertTriangle, Briefcase, CalendarDays, CheckCircle2, Clock, PartyPopper, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LoadingScreen, StatusScreen } from "@/features/psikotes-portal/components/status-screen";
import { formatDateLong, formatRupiah } from "@/lib/format";
import { useOffer } from "../queries";
import { OfferResponseForm } from "./offer-response-form";

/**
 * Portal offer kandidat (EPIC-004): lihat rincian penawaran kerja lalu
 * merespons (Terima / Ajukan Nego / Tolak). Respons + waktu + IP tercatat
 * sebagai bukti digital di sisi HRD.
 */
export function OfferPortalPage({ token }: { token: string }) {
  const { data: offer, error, isPending } = useOffer(token);

  if (isPending) return <LoadingScreen />;

  if (error || !offer) {
    return (
      <StatusScreen icon={AlertTriangle} iconClassName="text-amber-500" title="Link penawaran tidak berlaku">
        {error?.message ?? "Periksa kembali tautan dari HR, atau hubungi HR untuk informasi lebih lanjut."}
      </StatusScreen>
    );
  }

  if (offer.status === "expired") {
    return (
      <StatusScreen icon={Clock} iconClassName="text-red-500" title="Penawaran sudah kedaluwarsa">
        Masa berlaku penawaran ini telah berakhir. Silakan hubungi HR untuk informasi lebih lanjut.
      </StatusScreen>
    );
  }

  if (offer.status === "accepted") {
    return (
      <StatusScreen
        icon={PartyPopper}
        iconClassName="text-emerald-500"
        title={`Selamat bergabung, ${offer.candidate_name}! 🎉`}
      >
        Anda telah menerima penawaran ini
        {offer.responded_at && ` pada ${formatDateLong(offer.responded_at)}`}. Tim HR akan menghubungi Anda
        untuk proses onboarding.
      </StatusScreen>
    );
  }

  if (offer.status === "declined") {
    return (
      <StatusScreen icon={XCircle} iconClassName="text-muted-foreground" title="Penawaran telah Anda tolak">
        Terima kasih atas waktunya, {offer.candidate_name}. Semoga sukses selalu — data Anda tetap kami
        simpan untuk peluang yang sesuai di masa mendatang.
      </StatusScreen>
    );
  }

  // sent / negotiating
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-8">
      <Card className="w-full max-w-lg space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold">Penawaran Kerja</h1>
          <p className="text-sm text-muted-foreground">
            Halo <span className="font-medium text-foreground">{offer.candidate_name}</span> —
            selamat! Kami dengan senang hati menawarkan Anda posisi berikut
            {offer.brand_name ? ` di ${offer.brand_name}` : ""}.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 text-sm">
            <Briefcase className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-semibold text-foreground">{offer.position_title ?? "Posisi yang dilamar"}</span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gaji pokok per bulan</p>
            <p className="text-2xl font-bold text-foreground">{formatRupiah(offer.base_salary)}</p>
          </div>
          {offer.benefits.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Benefit & tunjangan</p>
              <ul className="space-y-1">
                {offer.benefits.map((benefit, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-foreground">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                    {benefit}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {offer.start_date && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
              Mulai kerja: {formatDateLong(offer.start_date)}
            </div>
          )}
          {offer.expires_at && (
            <p className="border-t border-border pt-2 text-xs text-amber-700 dark:text-amber-400">
              Mohon direspons sebelum {formatDateLong(offer.expires_at)}.
            </p>
          )}
        </div>

        {offer.status === "negotiating" && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-500/10 dark:text-blue-300">
            Pengajuan negosiasi Anda sudah tercatat
            {offer.response_note ? `: "${offer.response_note}"` : ""}. Anda tetap bisa menerima
            atau menolak penawaran ini, atau memperbarui catatan negosiasi.
          </p>
        )}

        <OfferResponseForm token={token} />

        <p className="text-center text-[11px] text-muted-foreground">
          Respons Anda tercatat secara digital (waktu & alamat IP) sebagai bukti persetujuan.
        </p>
      </Card>
    </div>
  );
}
