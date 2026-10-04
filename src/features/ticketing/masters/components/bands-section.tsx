"use client";

import { useState } from "react";
import { IdentificationIcon } from "@heroicons/react/24/outline";
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
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useBands, useRegisterBand, useUpdateBand } from "../queries";
import type { BandStatus, TicketBand } from "../types";

const STATUS_BADGES: Record<BandStatus, { label: string; className: string }> = {
  tersedia: { label: "Tersedia", className: "bg-emerald-100 text-emerald-700" },
  dipakai: { label: "Dipakai", className: "bg-blue-100 text-blue-700" },
  hilang: { label: "Hilang", className: "bg-red-100 text-red-700" },
  rusak: { label: "Rusak", className: "bg-gray-200 text-gray-600" },
  karyawan: { label: "Karyawan", className: "bg-purple-100 text-purple-700" },
};

export function BandsSection() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<BandStatus | "">("");
  const [page, setPage] = useState(1);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [uid, setUid] = useState("");
  const [label, setLabel] = useState("");

  const bandsQuery = useBands({ q, status, page });
  const bands = bandsQuery.data?.data ?? [];
  const meta = bandsQuery.data?.meta;

  const registerMutation = useRegisterBand(() => {
    // Biarkan dialog terbuka utk scan gelang berikutnya — hanya reset input
    setUid("");
    setLabel("");
  });
  const updateMutation = useUpdateBand();

  const handleRegister = () => {
    if (!uid.trim() || registerMutation.isPending) return;
    registerMutation.mutate({ nfc_uid: uid.trim(), label: label.trim() || null });
  };

  const setBandStatus = (band: TicketBand, next: BandStatus) => {
    updateMutation.mutate({ id: band.id, values: { status: next } });
  };

  return (
    <PurchasingListSection
      icon={IdentificationIcon}
      title="Registry Gelang NFC"
      description="Stok gelang milik venue — aset berputar yang diikat ke kunjungan saat registrasi."
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Cari UID / label…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="h-9 w-44"
          />
          <Select
            value={status || "semua"}
            onValueChange={(value) => {
              setStatus(value === "semua" ? "" : (value as BandStatus));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-36">
              <SelectValue placeholder="Semua status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">Semua status</SelectItem>
              {Object.entries(STATUS_BADGES).map(([value, meta]) => (
                <SelectItem key={value} value={value}>
                  {meta.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setRegisterOpen(true)}>
            Daftarkan Gelang
          </Button>
        </div>
      }
    >
      {bandsQuery.isLoading ? (
        <div className="py-14 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Memuat registry gelang...</p>
        </div>
      ) : (
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-sm">
            <thead>
              <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                <th className="px-4 py-3 text-left font-semibold">UID</th>
                <th className="px-4 py-3 text-left font-semibold">Label</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </TableRow>
            </thead>
            <tbody className="divide-y divide-gray-200/50">
              {bands.map((band) => {
                const badge = STATUS_BADGES[band.status];
                return (
                  <TableRow key={band.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {band.nfc_uid}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{band.label || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge className={`border-0 font-normal ${badge.className}`}>
                        {badge.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {band.status === "tersedia" ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setBandStatus(band, "hilang")}
                              className="h-8 px-3 text-gray-600 hover:bg-red-50 hover:text-red-600"
                            >
                              Hilang
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setBandStatus(band, "rusak")}
                              className="h-8 px-3 text-gray-600 hover:bg-gray-100"
                            >
                              Rusak
                            </Button>
                          </>
                        ) : band.status === "karyawan" ? (
                          <span className="text-xs text-gray-400">
                            dipegang karyawan — cabut di Gelang Karyawan
                          </span>
                        ) : band.status !== "dipakai" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setBandStatus(band, "tersedia")}
                            className="h-8 px-3 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700"
                          >
                            Tersedia Lagi
                          </Button>
                        ) : (
                          <span className="text-xs text-gray-400">
                            terikat kunjungan
                          </span>
                        )}
                      </div>
                    </td>
                  </TableRow>
                );
              })}
              {bands.length === 0 ? (
                <TableRow>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500">
                    Belum ada gelang terdaftar — klik “Daftarkan Gelang” lalu
                    scan gelang di reader.
                  </td>
                </TableRow>
              ) : null}
            </tbody>
          </table>
          {meta && meta.totalPages > 1 ? (
            <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
              <span>
                Hal {meta.page} dari {meta.totalPages} ({meta.total} gelang)
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Sebelumnya
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Berikutnya
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Daftarkan Gelang Baru</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="band_uid">UID Gelang *</Label>
              <Input
                id="band_uid"
                autoFocus
                placeholder="Fokuskan kursor di sini lalu tap gelang di reader"
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                onKeyDown={(e) => {
                  // Reader keyboard-wedge mengetik UID + Enter
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleRegister();
                  }
                }}
                className="font-mono"
              />
              <p className="text-xs text-gray-500">
                Reader wedge otomatis mengetik UID; bisa juga diketik manual (hex)
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="band_label">Label Fisik</Label>
              <Input
                id="band_label"
                placeholder="mis. Gelang Biru #012"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <p className="text-xs text-gray-500">
              Dialog tetap terbuka setelah berhasil — langsung tap gelang
              berikutnya untuk pendaftaran beruntun.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>
              Selesai
            </Button>
            <Button
              onClick={handleRegister}
              disabled={!uid.trim() || registerMutation.isPending}
            >
              {registerMutation.isPending ? "Mendaftarkan…" : "Daftarkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PurchasingListSection>
  );
}
