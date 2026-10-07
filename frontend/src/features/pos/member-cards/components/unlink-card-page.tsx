"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2, Nfc, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { POS_NFC_CARD_EVENT, normalizeNfcUid, usePosNfcOptional } from "@/features/pos/nfc";
import {
  fetchMemberByCard,
  fetchMemberCards,
  memberCardsQueryKey,
  submitMemberCardAction,
  type MemberCardAction,
} from "../api";
import type { CardDialog } from "../types";
import { CancelRefundDialog, CompleteRefundDialog, RefundDialog, UnlinkDialog } from "./card-dialogs";
import { MemberCardGrid, OpenRefundRequests, RefundHistory, UnlinkHistory } from "./member-card-lists";

/**
 * POS → Member → Unlink Card (permintaan owner 2026-09-01): daftar member
 * berkartu, bisa dicari atau langsung di-tap kartunya lewat pembaca NFC,
 * lalu kartunya dilepas (hilang / dikembalikan) TANPA mereset saldo.
 *
 * Refund (owner 2026-09-04): tombol "Refund" di samping Unlink = kartu
 * dilepas + permintaan refund dicatat untuk Finance. Setelah Finance
 * mengonfirmasi uang sudah dikembalikan, permintaan ditandai "Refund
 * Completed" (PIN supervisor) dan saldo member di-nol-kan.
 * Dirancang ramah tablet kasir: kartu besar, tombol alasan besar.
 */
export function UnlinkCardPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [dialog, setDialog] = useState<CardDialog>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const list = useQuery({ queryKey: memberCardsQueryKey(applied), queryFn: () => fetchMemberCards(applied) });
  const data = list.data ?? null;
  useEffect(() => {
    if (list.error) toast.error(list.error instanceof Error ? list.error.message : "Gagal memuat");
  }, [list.error]);

  // paymentNfcActive memberi tahu listener global agar scan dikirim ke halaman
  // ini, bukan dialihkan ke halaman Topup.
  const setPaymentNfcActive = usePosNfcOptional()?.setPaymentNfcActive;
  useEffect(() => {
    setPaymentNfcActive?.(true);
    return () => setPaymentNfcActive?.(false);
  }, [setPaymentNfcActive]);

  // Tap kartu NFC → langsung buka member pemilik kartu itu.
  const onCardScanned = useEffectEvent(async (raw: string | undefined) => {
    const uid = normalizeNfcUid(raw ?? "");
    if (!uid) return;
    setScanning(true);
    try {
      const found = await fetchMemberByCard(uid);
      if (!found) {
        toast.error(`Kartu ${uid} tidak terdaftar atau sudah dilepas`);
        return;
      }
      setDialog({ kind: "unlink", member: found });
      toast.success(`Kartu milik ${found.name || found.phone} terbaca`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membaca kartu");
    } finally {
      setScanning(false);
    }
  });
  useEffect(() => {
    const onCard = (event: Event) => void onCardScanned((event as CustomEvent<{ card?: string }>).detail?.card);
    window.addEventListener(POS_NFC_CARD_EVENT, onCard);
    return () => window.removeEventListener(POS_NFC_CARD_EVENT, onCard);
  }, []);

  async function submit(action: MemberCardAction) {
    if (busy) return;
    setBusy(true);
    try {
      toast.success(await submitMemberCardAction(action));
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: ["pos", "member-cards"] });
    } catch (err) {
      // Termasuk 429: kasir terkunci setelah PIN supervisor salah berulang.
      toast.error(err instanceof Error ? err.message : "Gagal memproses");
    } finally {
      setBusy(false);
    }
  }

  const closeDialog = () => {
    if (!busy) setDialog(null);
  };
  const dialogProps = { busy, onClose: closeDialog, onSubmit: (action: MemberCardAction) => void submit(action) };
  const requests = data?.refund_requests ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <CreditCard className="h-6 w-6 text-brand-text" />
          Unlink Card
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Lepaskan kartu NFC dari member — kartu hilang atau dikembalikan. Saldo ARK dan XP member{" "}
          <span className="font-semibold text-gray-700">tetap utuh</span>; hanya tautan kartunya yang dilepas. Pilih{" "}
          <span className="font-semibold text-gray-700">Refund</span> bila member ingin saldonya dikembalikan: kartu dilepas dan
          permintaan diteruskan ke Finance.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(search.trim());
            }}
          >
            <Input
              aria-label="Cari member berkartu"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama / no. HP / UID kartu…"
              className="h-11"
            />
            <Button type="submit" className="h-11 gap-2">
              <Search className="h-4 w-4" /> Cari
            </Button>
          </form>
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm text-brand-text">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Nfc className="h-4 w-4" />}
            {scanning ? "Membaca kartu…" : "Atau tap kartu NFC untuk langsung membuka member"}
          </div>
        </CardContent>
      </Card>

      <OpenRefundRequests
        requests={requests.filter((r) => r.status === "requested")}
        onComplete={(request) => setDialog({ kind: "complete", request })}
        onCancel={(request) => setDialog({ kind: "cancel", request })}
      />

      {data === null ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat member berkartu…
          </CardContent>
        </Card>
      ) : data.members.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-gray-500">
            {applied ? `Tidak ada member berkartu yang cocok dengan “${applied}”.` : "Belum ada member yang punya kartu tertaut."}
          </CardContent>
        </Card>
      ) : (
        <MemberCardGrid
          members={data.members}
          onUnlink={(member) => setDialog({ kind: "unlink", member })}
          onRefund={(member) => setDialog({ kind: "refund", member })}
        />
      )}

      <RefundHistory requests={requests.filter((r) => r.status !== "requested")} />
      <UnlinkHistory logs={data?.recent_unlinks ?? []} />

      {dialog?.kind === "unlink" ? <UnlinkDialog key={dialog.member.id} member={dialog.member} {...dialogProps} /> : null}
      {dialog?.kind === "refund" ? <RefundDialog key={dialog.member.id} member={dialog.member} {...dialogProps} /> : null}
      {dialog?.kind === "complete" ? (
        <CompleteRefundDialog key={dialog.request.id} request={dialog.request} {...dialogProps} />
      ) : null}
      {dialog?.kind === "cancel" ? (
        <CancelRefundDialog key={dialog.request.id} request={dialog.request} {...dialogProps} />
      ) : null}
    </div>
  );
}
