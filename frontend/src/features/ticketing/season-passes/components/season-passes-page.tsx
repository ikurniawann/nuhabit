"use client";

import { useState } from "react";
import { TicketIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
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
import { TableRow } from "@/components/ui/table";
import { formatDate, formatRupiah } from "@/lib/format";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useIssuePass, usePassOptions, usePasses, useRenewPass } from "../queries";
import { ENTRY_POLICY_LABEL, type IssuedPassResult } from "../types";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  expired: "bg-gray-200 text-gray-600",
  suspended: "bg-orange-100 text-orange-700",
  cancelled: "bg-red-100 text-red-700",
};

export function SeasonPassesPage() {
  const [q, setQ] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [holderName, setHolderName] = useState("");
  const [holderPhone, setHolderPhone] = useState("");
  const [bandUid, setBandUid] = useState("");
  const [issued, setIssued] = useState<IssuedPassResult | null>(null);

  const passesQuery = usePasses(q);
  const passes = passesQuery.data ?? [];
  const optionsQuery = usePassOptions();
  const options = optionsQuery.data ?? [];

  const selectedOption =
    options.find((o) => o.ticket_product_id === productId) ?? null;

  const resetForm = () => {
    setProductId("");
    setHolderName("");
    setHolderPhone("");
    setBandUid("");
  };

  const issueMutation = useIssuePass((result) => {
    setIssued(result);
    setIssueOpen(false);
    resetForm();
  });
  const renewMutation = useRenewPass();

  const canSubmit =
    productId && holderName.trim().length >= 2 && !issueMutation.isPending;

  const handleIssue = () => {
    if (!canSubmit) return;
    issueMutation.mutate({
      ticket_product_id: productId,
      holder_name: holderName.trim(),
      holder_phone: holderPhone.trim() || null,
      band_uid: bandUid.trim() || null,
    });
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Season Pass</h1>
        <p className="mt-1 text-sm text-gray-500">
          Terbitkan pass masuk berlaku (annual/berkala) di loket. Pass langsung
          aktif setelah dibayar — tunjukkan/scan QR di gate untuk masuk.
        </p>
      </div>

      <PurchasingListSection
        icon={TicketIcon}
        title="Pass Terbit"
        description="Daftar pass yang sudah diterbitkan di venue ini."
        toolbar={
          <div className="flex items-center gap-2">
            <Input
              placeholder="Cari kode / nama / HP…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-52"
            />
            <Button
              size="sm"
              onClick={() => setIssueOpen(true)}
              disabled={options.length === 0}
              title={
                options.length === 0
                  ? "Belum ada produk Season Pass aktif — buat di Master Ticket"
                  : undefined
              }
            >
              Terbitkan Pass
            </Button>
          </div>
        }
      >
        {passesQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat pass…</p>
          </div>
        ) : passes.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">
            Belum ada pass diterbitkan — klik “Terbitkan Pass”.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Pass</th>
                  <th className="px-4 py-3 text-left font-semibold">Pemegang</th>
                  <th className="px-4 py-3 text-left font-semibold">Kebijakan</th>
                  <th className="px-4 py-3 text-left font-semibold">Berlaku s/d</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody>
                {passes.map((p) => (
                  <TableRow
                    key={p.id}
                    className="border-b border-gray-100 hover:bg-gray-50/60"
                  >
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-medium text-gray-900">
                        {p.pass_code}
                      </p>
                      <p className="text-xs text-gray-500">{p.product_name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{p.holder_name}</p>
                      {p.holder_phone && (
                        <p className="text-xs text-gray-500">{p.holder_phone}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {ENTRY_POLICY_LABEL[p.entry_policy]}
                      {p.entry_policy === "limited_visits" && (
                        <span className="ml-1 text-xs text-gray-400">
                          ({p.visit_quota_used}/{p.visit_quota_total})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDate(p.valid_until, "—")}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={`border-0 font-normal ${
                          STATUS_STYLE[p.status] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {p.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          p.status === "pending" ||
                          p.status === "cancelled" ||
                          renewMutation.isPending
                        }
                        onClick={() => renewMutation.mutate(p.id)}
                      >
                        Perpanjang
                      </Button>
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      {/* Dialog terbitkan */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Terbitkan Season Pass</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Produk Pass *</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih produk pass…" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.ticket_product_id} value={o.ticket_product_id}>
                      {o.name} — {formatRupiah(o.unit_price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedOption && (
                <p className="text-xs text-gray-500">
                  Berlaku {selectedOption.validity_months} bulan ·{" "}
                  {ENTRY_POLICY_LABEL[selectedOption.entry_policy]}
                  {selectedOption.entry_policy === "limited_visits" &&
                    ` (${selectedOption.visit_quota}× kunjungan)`}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holder_name">Nama Pemegang *</Label>
              <Input
                id="holder_name"
                placeholder="Nama sesuai identitas"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holder_phone">No. WhatsApp</Label>
              <Input
                id="holder_phone"
                placeholder="08xxxxxxxxxx (opsional)"
                value={holderPhone}
                onChange={(e) => setHolderPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="band_uid">UID Gelang NFC</Label>
              <Input
                id="band_uid"
                placeholder="Tap/scan gelang (opsional)"
                value={bandUid}
                onChange={(e) => setBandUid(e.target.value)}
              />
              <p className="text-xs text-gray-500">
                Opsional — tautkan gelang NFC yang sudah terdaftar untuk tap di gate.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleIssue} disabled={!canSubmit}>
              {issueMutation.isPending ? "Menerbitkan…" : "Terbitkan & Bayar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog QR hasil terbit */}
      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pass Diterbitkan</DialogTitle>
          </DialogHeader>
          {issued && (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <QRCodeSVG value={issued.access_token} size={200} />
              </div>
              <p className="font-mono text-sm font-semibold text-gray-900">
                {issued.pass_code}
              </p>
              <p className="text-sm text-gray-700">{issued.holder_name}</p>
              <p className="text-xs text-gray-500">
                Berlaku {formatDate(issued.valid_from, "—")} —{" "}
                {formatDate(issued.valid_until, "—")} ·{" "}
                {ENTRY_POLICY_LABEL[issued.entry_policy]}
              </p>
              <p className="text-xs text-gray-400">
                Tunjukkan / scan QR ini di gate untuk masuk.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIssued(null);
                setIssueOpen(true);
              }}
            >
              Terbitkan lagi
            </Button>
            <Button onClick={() => setIssued(null)}>Selesai</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
