"use client";

// EPIC-034 — tab Gift Card di menu Promo: terbit manual/batch, lihat saldo
// & riwayat, disable, koreksi, reload, tautkan member, cetak QR.

import { useState } from "react";
import { GiftIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { toast } from "sonner";
import {
  useAdjustGiftCard,
  useGiftCardConfig,
  useIssueGiftCard,
  useGiftCards,
  useSaveGiftCardConfig,
  useToggleGiftCard,
} from "../gift-card-queries";
import {
  GIFT_CARD_STATUS_LABELS,
  type GiftCard,
  type GiftCardStatus,
} from "../gift-card-types";
import { GiftCardLedgerDialog } from "./gift-card-ledger-dialog";
import {
  GiftCardMemberDialog,
  GiftCardPrintDialog,
  GiftCardReloadDialog,
} from "./gift-card-dialogs";
import { formatDate, formatRupiah } from "@/lib/format";


const STATUS_BADGE: Record<GiftCardStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  active: "bg-emerald-100 text-emerald-700",
  disabled: "bg-red-100 text-red-700",
  exhausted: "bg-gray-100 text-gray-500",
  expired: "bg-amber-100 text-amber-700",
};

type IssueMode = "single" | "batch";

interface IssueForm {
  mode: IssueMode;
  initial_value: string;
  expires_at: string;
  count: string;
  buyer_name: string;
  buyer_phone: string;
  note: string;
}

const EMPTY_FORM: IssueForm = {
  mode: "single",
  initial_value: "",
  expires_at: "",
  count: "1",
  buyer_name: "",
  buyer_phone: "",
  note: "",
};

export function GiftCardPage() {
  const [phoneFilter, setPhoneFilter] = useState("");
  const [phoneQuery, setPhoneQuery] = useState("");
  const cardsQuery = useGiftCards(phoneQuery ? { phone: phoneQuery } : undefined);
  const toggleMutation = useToggleGiftCard();
  const configQuery = useGiftCardConfig();
  const saveConfigMutation = useSaveGiftCardConfig();
  const [issueOpen, setIssueOpen] = useState(false);
  const [form, setForm] = useState<IssueForm>(EMPTY_FORM);
  const [ledgerCard, setLedgerCard] = useState<GiftCard | null>(null);
  const [reloadCard, setReloadCard] = useState<GiftCard | null>(null);
  const [memberCard, setMemberCard] = useState<GiftCard | null>(null);
  const [printCard, setPrintCard] = useState<GiftCard | null>(null);
  // EPIC-034 Fase C — koreksi saldo ber-audit
  const [adjustCard, setAdjustCard] = useState<GiftCard | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const adjustMutation = useAdjustGiftCard(() => {
    setAdjustCard(null);
    setAdjustDelta("");
    setAdjustReason("");
  });
  // Konfigurasi nominal & masa berlaku (keputusan owner #4)
  const [presetsInput, setPresetsInput] = useState<string | null>(null);
  const [expiryInput, setExpiryInput] = useState<string | null>(null);

  const config = configQuery.data;
  const presetsValue =
    presetsInput ?? (config ? config.presets.join(", ") : "");
  const expiryValue =
    expiryInput ?? (config?.expiry_months != null ? String(config.expiry_months) : "");

  const handleSaveConfig = () => {
    const presets = presetsValue
      .split(",")
      .map((part) => Number(part.replace(/[^\d]/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (presets.length === 0) {
      toast.error("Isi minimal satu nominal preset");
      return;
    }
    const months = expiryValue.trim() === "" ? null : Number(expiryValue);
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) {
      toast.error("Masa berlaku harus 1–120 bulan, atau kosong untuk tanpa batas");
      return;
    }
    saveConfigMutation.mutate({
      presets,
      expiry_months: months,
      allow_custom: config?.allow_custom ?? true,
    });
    setPresetsInput(null);
    setExpiryInput(null);
  };

  const adjustDeltaNum = Number(adjustDelta.replace(/[^\d-]/g, ""));
  const adjustInvalid =
    !Number.isFinite(adjustDeltaNum) ||
    adjustDeltaNum === 0 ||
    adjustReason.trim().length < 5;
  const issueMutation = useIssueGiftCard(() => {
    setIssueOpen(false);
    setForm(EMPTY_FORM);
  });

  const set = (patch: Partial<IssueForm>) =>
    setForm((current) => ({ ...current, ...patch }));

  const initialValueNum = Number(form.initial_value);
  const countNum = Number(form.count);
  const formInvalid =
    form.initial_value.trim() === "" ||
    Number.isNaN(initialValueNum) ||
    initialValueNum <= 0 ||
    (form.mode === "batch" &&
      (form.count.trim() === "" || Number.isNaN(countNum) || countNum < 1));

  const handleIssue = () => {
    if (formInvalid || issueMutation.isPending) return;
    if (form.mode === "single") {
      issueMutation.mutate({
        mode: "single",
        initial_value: initialValueNum,
        expires_at: form.expires_at || null,
        buyer_name: form.buyer_name.trim() || null,
        buyer_phone: form.buyer_phone.trim() || null,
        note: form.note.trim() || null,
      });
    } else {
      issueMutation.mutate({
        mode: "batch",
        initial_value: initialValueNum,
        count: countNum,
        expires_at: form.expires_at || null,
      });
    }
  };

  const cards = cardsQuery.data ?? [];

  return (
    <div className="space-y-6">
      {/* EPIC-034 Fase B — nominal & masa berlaku dipakai kasir saat menjual */}
      <div className="rounded-xl border border-gray-200/70 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">
          Konfigurasi Penjualan di Kasir
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          Nominal preset yang muncul di kasir dan masa berlaku kartu baru.
          Berlaku untuk penjualan gift card di POS.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gc-presets">Nominal preset (pisahkan koma)</Label>
            <Input
              id="gc-presets"
              value={presetsValue}
              placeholder="50000, 100000, 200000"
              disabled={configQuery.isLoading}
              onChange={(e) => setPresetsInput(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gc-expiry">Masa berlaku (bulan)</Label>
            <Input
              id="gc-expiry"
              inputMode="numeric"
              value={expiryValue}
              placeholder="Kosongkan = tanpa kedaluwarsa"
              disabled={configQuery.isLoading}
              onChange={(e) => setExpiryInput(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <Switch
              checked={config?.allow_custom ?? true}
              disabled={configQuery.isLoading || saveConfigMutation.isPending}
              onCheckedChange={(checked) =>
                saveConfigMutation.mutate({ allow_custom: checked })
              }
            />
            Kasir boleh mengetik nominal bebas
          </label>
          <Button
            size="sm"
            onClick={handleSaveConfig}
            disabled={configQuery.isLoading || saveConfigMutation.isPending}
          >
            Simpan konfigurasi
          </Button>
        </div>
      </div>

      <PurchasingListSection
        icon={GiftIcon}
        title="Gift Card"
        description="Saldo prepaid — dibeli sekali (kasir/online), dipakai berkali-kali sampai habis. Beda dari voucher: gift card adalah uang titipan."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setPhoneQuery(phoneFilter.replace(/\D/g, ""));
              }}
            >
              <Input
                inputMode="tel"
                placeholder="Cari no. HP member/pembeli"
                value={phoneFilter}
                onChange={(e) => {
                  setPhoneFilter(e.target.value);
                  if (!e.target.value.trim()) setPhoneQuery("");
                }}
                className="h-9 w-56"
              />
              <Button size="sm" variant="outline" type="submit">
                Cari
              </Button>
            </form>
            <Button size="sm" onClick={() => setIssueOpen(true)}>
              Terbitkan Gift Card
            </Button>
          </div>
        }
      >
        {cardsQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat gift card...</p>
          </div>
        ) : cards.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            {phoneQuery
              ? "Tidak ada gift card untuk nomor itu."
              : "Belum ada gift card — mulai dari \u201cTerbitkan Gift Card\u201d."}
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Kode</th>
                  <th className="px-4 py-3 text-right font-semibold">Nominal Awal</th>
                  <th className="px-4 py-3 text-right font-semibold">Saldo</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Kedaluwarsa</th>
                  <th className="px-4 py-3 text-left font-semibold">Pembeli / Member</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {cards.map((card) => (
                  <TableRow key={card.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">
                      {card.code}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatRupiah(card.initial_value)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                      {formatRupiah(card.balance)}
                      {Number(card.reloaded_total) > 0 ? (
                        <p className="text-xs font-normal text-muted-foreground">
                          reload {formatRupiah(card.reloaded_total)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`border-0 font-normal ${STATUS_BADGE[card.status]}`}>
                        {GIFT_CARD_STATUS_LABELS[card.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {card.expires_at
                        ? formatDate(card.expires_at)
                        : "Tanpa batas"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {card.buyer_name ?? "—"}
                      {card.buyer_phone ? ` · ${card.buyer_phone}` : ""}
                      {card.customer_id ? (
                        <Badge variant="info" className="ml-2">
                          {card.customer_name ?? "Member"}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3"
                          onClick={() => setLedgerCard(card)}
                        >
                          Riwayat
                        </Button>
                        {(card.status === "active" || card.status === "exhausted") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3"
                            onClick={() => setReloadCard(card)}
                          >
                            Reload
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3"
                          onClick={() => setMemberCard(card)}
                        >
                          Member
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3"
                          onClick={() => setPrintCard(card)}
                        >
                          QR
                        </Button>
                        {card.status !== "pending" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3"
                            onClick={() => setAdjustCard(card)}
                          >
                            Koreksi
                          </Button>
                        )}
                        {(card.status === "active" || card.status === "disabled") && (
                          <Switch
                            checked={card.status === "active"}
                            disabled={toggleMutation.isPending}
                            onCheckedChange={(checked) =>
                              toggleMutation.mutate({ id: card.id, isActive: checked })
                            }
                          />
                        )}
                      </div>
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      {/* Koreksi saldo ber-audit — selain void order lunas di kasir. */}
      <Dialog
        open={Boolean(adjustCard)}
        onOpenChange={(open) => {
          if (!open) {
            setAdjustCard(null);
            setAdjustDelta("");
            setAdjustReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Koreksi Saldo Gift Card</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="font-mono font-medium">{adjustCard?.code}</span>
              <span className="ml-2 text-gray-500">
                saldo saat ini {formatRupiah(adjustCard?.balance ?? 0)}
              </span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gc-delta">Nominal koreksi</Label>
              <Input
                id="gc-delta"
                value={adjustDelta}
                placeholder="Contoh: 50000 (menambah) atau -50000 (menarik)"
                onChange={(e) => setAdjustDelta(e.target.value)}
              />
              <p className="text-xs text-gray-500">
                Positif mengembalikan saldo, negatif menarik saldo. Tidak boleh
                melebihi total nilai yang pernah diisi (terbit + reload).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gc-reason">Alasan (wajib)</Label>
              <Input
                id="gc-reason"
                value={adjustReason}
                placeholder="Mis. salah input kasir order #1234"
                onChange={(e) => setAdjustReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAdjustCard(null)}
              disabled={adjustMutation.isPending}
            >
              Batal
            </Button>
            <Button
              disabled={adjustInvalid || adjustMutation.isPending}
              onClick={() =>
                adjustCard &&
                adjustMutation.mutate({
                  id: adjustCard.id,
                  delta: adjustDeltaNum,
                  reason: adjustReason.trim(),
                })
              }
            >
              {adjustMutation.isPending ? "Menyimpan…" : "Simpan koreksi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Terbitkan Gift Card</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select
                value={form.mode}
                onValueChange={(v) => set({ mode: v as IssueMode })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Satu kartu (dgn data pembeli)</SelectItem>
                  <SelectItem value="batch">Batch stok (tanpa data pembeli)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="gc_value">Nominal (Rp)</Label>
                <Input
                  id="gc_value"
                  type="number"
                  min={1}
                  value={form.initial_value}
                  onChange={(e) => set({ initial_value: e.target.value })}
                />
              </div>
              {form.mode === "batch" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="gc_count">Jumlah Kartu</Label>
                  <Input
                    id="gc_count"
                    type="number"
                    min={1}
                    max={500}
                    value={form.count}
                    onChange={(e) => set({ count: e.target.value })}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="gc_expires">Kedaluwarsa (opsional)</Label>
                  <Input
                    id="gc_expires"
                    type="date"
                    value={form.expires_at}
                    onChange={(e) => set({ expires_at: e.target.value })}
                  />
                </div>
              )}
            </div>
            {form.mode === "batch" && (
              <div className="space-y-1.5">
                <Label htmlFor="gc_expires_batch">Kedaluwarsa (opsional)</Label>
                <Input
                  id="gc_expires_batch"
                  type="date"
                  value={form.expires_at}
                  onChange={(e) => set({ expires_at: e.target.value })}
                />
              </div>
            )}
            {form.mode === "single" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="gc_buyer_name">Nama Pembeli (opsional)</Label>
                    <Input
                      id="gc_buyer_name"
                      value={form.buyer_name}
                      onChange={(e) => set({ buyer_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="gc_buyer_phone">No. WA (opsional)</Label>
                    <Input
                      id="gc_buyer_phone"
                      placeholder="mis. 6281234567890"
                      value={form.buyer_phone}
                      onChange={(e) => set({ buyer_phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gc_note">Catatan (opsional)</Label>
                  <Input
                    id="gc_note"
                    value={form.note}
                    onChange={(e) => set({ note: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleIssue} disabled={formInvalid || issueMutation.isPending}>
              {issueMutation.isPending ? "Menerbitkan…" : "Terbitkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GiftCardLedgerDialog
        card={ledgerCard}
        onOpenChange={(open) => !open && setLedgerCard(null)}
      />
      <GiftCardReloadDialog card={reloadCard} onClose={() => setReloadCard(null)} />
      <GiftCardMemberDialog card={memberCard} onClose={() => setMemberCard(null)} />
      <GiftCardPrintDialog card={printCard} onClose={() => setPrintCard(null)} />
    </div>
  );
}
