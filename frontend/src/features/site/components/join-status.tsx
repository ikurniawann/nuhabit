"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, LoaderCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, memberApi } from "@/features/member-app/lib/api";
import { formatRupiah } from "@/lib/format";
import { creditsLabel, validityLabel } from "../lib/plans";
import { pollInterval, purchaseOutcome, type PurchaseView } from "../lib/purchase-status";
import { Container, Section, Tile } from "./site-section";

const OUTCOMES = {
  pending: {
    title: "Menunggu pembayaran",
    text: "Selesaikan pembayaran di halaman Xendit. Status di sini ikut berubah begitu pembayaran diterima.",
    Icon: Clock,
    tone: "text-muted-foreground",
  },
  paid: { title: "Pembayaran berhasil", text: "Paketmu sudah aktif. Pesan kelas pertamamu di Area Member.", Icon: CheckCircle2, tone: "text-success" },
  expired: {
    title: "Invoice kedaluwarsa",
    text: "Batas waktu pembayaran lewat. Pilih paketnya lagi untuk membuat invoice baru.",
    Icon: XCircle,
    tone: "text-danger",
  },
  failed: { title: "Pembayaran gagal", text: "Pembayaran tidak selesai. Pilih paketnya lagi atau hubungi cabang.", Icon: XCircle, tone: "text-danger" },
} as const;

/** Step 3 of /join: polls the purchase until the invoice is paid, expired or failed. */
export function JoinStatus({ purchaseId }: { purchaseId: string }) {
  const query = useQuery({
    queryKey: ["join", "purchase", purchaseId],
    queryFn: () => memberApi<PurchaseView>(`/gym/credits/purchases/${purchaseId}`),
    retry: false,
    refetchInterval: (q) => pollInterval(q.state.data),
  });

  let body;
  if (query.isPending) {
    body = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy>
        <LoaderCircle className="size-4 animate-spin" /> Memuat status pembayaran
      </p>
    );
  } else if (query.isError) {
    const signedOut = query.error instanceof ApiError && query.error.status === 401;
    body = (
      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold">{signedOut ? "Sesi berakhir" : "Status belum bisa dimuat"}</h2>
        <p className="text-sm text-body">
          {signedOut ? "Masuk ke Area Member untuk melihat status pembelianmu." : query.error.message}
        </p>
        <Button asChild>
          <Link href="/member">Buka Area Member</Link>
        </Button>
      </div>
    );
  } else {
    const purchase = query.data;
    const outcome = purchaseOutcome(purchase.status);
    const { title, text, Icon, tone } = OUTCOMES[outcome];
    body = (
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <Icon className={`size-8 shrink-0 ${tone}`} />
          <div>
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <p className="text-sm text-body">{text}</p>
          </div>
        </div>
        <ul className="space-y-1 text-sm text-body">
          <li className="font-semibold text-foreground">{purchase.package_name}</li>
          <li>{creditsLabel(purchase)}</li>
          <li>Berlaku {validityLabel(purchase.validity_days)}</li>
          <li className="tabular-nums">{formatRupiah(purchase.total_idr)}</li>
        </ul>
        <div className="flex flex-wrap gap-3">
          {outcome === "paid" ? (
            <Button asChild size="lg">
              <Link href="/member">Buka Area Member</Link>
            </Button>
          ) : null}
          {outcome === "pending" && purchase.invoice_url ? (
            <Button asChild size="lg">
              <a href={purchase.invoice_url}>Lanjutkan pembayaran</a>
            </Button>
          ) : null}
          {outcome === "expired" || outcome === "failed" ? (
            <Button asChild size="lg">
              <Link href="/join">Pilih paket lagi</Link>
            </Button>
          ) : null}
          {outcome !== "paid" ? (
            <Button asChild variant="outline" size="lg">
              <Link href="/member">Area Member</Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <Section>
      <Container className="max-w-2xl space-y-6">
        <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Status pembelian</h1>
        <Tile>{body}</Tile>
      </Container>
    </Section>
  );
}
