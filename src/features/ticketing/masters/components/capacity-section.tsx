"use client";

import { useState } from "react";
import { UserGroupIcon } from "@heroicons/react/24/outline";
import { Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatNumber } from "@/lib/format";
import { addDaysIso } from "@/lib/ticketing/calendar";
import { todayIso } from "@/lib/ticketing/ui-dates";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import {
  useCapacityDates,
  useCreateCapacityDate,
  useDeleteCapacityDate,
  useOccupancyRange,
  useTicketingSettings,
  useUpdateCapacityDate,
  useUpdateSettings,
} from "../queries";

// EPIC-031 A3 — kuota harian venue (per ORANG, online + walk-in).
// Default venue di ticket_settings.daily_capacity (kosong = unlimited);
// override per rentang tanggal (0 = tanggal tutup). Overlap → kapasitas
// terkecil menang (resolver lib/ticketing/capacity.ts).

interface OverrideForm {
  label: string;
  start_date: string;
  end_date: string;
  capacity: string;
}

const EMPTY_OVERRIDE: OverrideForm = {
  label: "",
  start_date: "",
  end_date: "",
  capacity: "",
};

export function CapacitySection() {
  const settingsQuery = useTicketingSettings();
  const capacityQuery = useCapacityDates();
  const updateSettings = useUpdateSettings();
  const [draft, setDraft] = useState<OverrideForm>(EMPTY_OVERRIDE);
  const createMutation = useCreateCapacityDate(() => setDraft(EMPTY_OVERRIDE));
  const updateMutation = useUpdateCapacityDate();
  const deleteMutation = useDeleteCapacityDate();

  // Pola general-settings: nilai server + edit lokal di-derive tiap render
  const [capacityEdit, setCapacityEdit] = useState<string | null>(null);
  const settings = settingsQuery.data;
  const capacityValue =
    capacityEdit ??
    (settings?.daily_capacity === null || settings?.daily_capacity === undefined
      ? ""
      : String(settings.daily_capacity));

  // Peringatan LIVE (utang A3, keputusan tunda ke Fase C): bila kapasitas
  // baru < okupansi tertinggi 90 hari ke depan → transaksi existing aman,
  // tapi ada tanggal yang langsung berstatus penuh
  const today = todayIso();
  const occupancyQuery = useOccupancyRange(today, addDaysIso(today, 90));
  const worstUpcoming = (() => {
    const days = occupancyQuery.data ?? [];
    let worst: { date: string; used: number } | null = null;
    for (const d of days) {
      const used = d.online + d.walk_in;
      if (used > 0 && (!worst || used > worst.used)) worst = { date: d.date, used };
    }
    return worst;
  })();
  const capacityNum = capacityValue.trim() === "" ? null : Number(capacityValue);
  const capacityBelowOccupancy =
    capacityNum !== null && worstUpcoming !== null && capacityNum < worstUpcoming.used;

  const draftCapacityNum = draft.capacity.trim() === "" ? null : Number(draft.capacity);
  const draftRangeInvalid =
    draft.start_date !== "" && draft.end_date !== "" && draft.end_date < draft.start_date;
  const draftIncomplete =
    draft.label.trim() === "" ||
    draft.start_date === "" ||
    draft.end_date === "" ||
    draftCapacityNum === null ||
    Number.isNaN(draftCapacityNum) ||
    draftCapacityNum < 0;

  const handleSaveDefault = () => {
    if (updateSettings.isPending) return;
    const trimmed = capacityValue.trim();
    updateSettings.mutate({
      // Kosong = unlimited (perilaku sebelum EPIC-031)
      daily_capacity: trimmed === "" ? null : Math.max(1, Number(trimmed) || 0),
    });
  };

  const handleAddOverride = () => {
    if (createMutation.isPending || draftIncomplete || draftRangeInvalid) return;
    createMutation.mutate({
      label: draft.label.trim(),
      start_date: draft.start_date,
      end_date: draft.end_date,
      capacity: draftCapacityNum as number,
    });
  };

  const overrides = capacityQuery.data ?? [];

  return (
    <PurchasingListSection
      icon={UserGroupIcon}
      title="Kapasitas Harian"
      description="Kuota pengunjung per tanggal (dihitung per orang, booking online + walk-in loket). Kosong = tanpa batas."
    >
      {settingsQuery.isLoading ? (
        <div className="py-14 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Memuat pengaturan...</p>
        </div>
      ) : (
        <div className="grid gap-6 px-5 py-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="daily_capacity">Kapasitas Default per Hari (orang)</Label>
              <div className="flex gap-2">
                <Input
                  id="daily_capacity"
                  type="number"
                  min={1}
                  placeholder="kosong = tanpa batas (unlimited)"
                  value={capacityValue}
                  onChange={(e) =>
                    setCapacityEdit(e.target.value.replace(/\D/g, ""))
                  }
                />
                <Button
                  size="sm"
                  onClick={handleSaveDefault}
                  disabled={updateSettings.isPending}
                >
                  {updateSettings.isPending ? "Menyimpan…" : "Simpan"}
                </Button>
              </div>
              <p className="text-xs text-gray-500">
                {capacityValue.trim() === "" ? (
                  <>
                    Kuota BELUM aktif — semua tanggal tanpa batas. Booking
                    online & loket berjalan seperti biasa.
                  </>
                ) : (
                  <>
                    Maksimum {formatNumber(capacityValue)}{" "}
                    orang/hari (booking online yang belum kedaluwarsa +
                    pengunjung walk-in). Tanggal penuh otomatis ditutup di
                    kalender booking & loket.
                  </>
                )}
              </p>
            </div>
            {capacityBelowOccupancy && worstUpcoming ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                Perhatian: okupansi {formatDate(worstUpcoming.date)} sudah{" "}
                {formatNumber(worstUpcoming.used)} orang — di atas
                kapasitas yang akan disimpan. Booking existing tidak
                dibatalkan, tapi tanggal tersebut langsung berstatus penuh.
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Menurunkan kapasitas di bawah jumlah yang sudah ter-booking
                tidak membatalkan booking yang ada — hanya transaksi baru yang
                ditolak.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <Label>Override per Rentang Tanggal</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                className="col-span-2"
                placeholder="Label — mis. Libur Lebaran"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              />
              <Input
                type="date"
                aria-label="Tanggal mulai"
                value={draft.start_date}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, start_date: e.target.value }))
                }
              />
              <Input
                type="date"
                aria-label="Tanggal akhir"
                aria-invalid={draftRangeInvalid}
                value={draft.end_date}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, end_date: e.target.value }))
                }
              />
              <Input
                type="number"
                min={0}
                placeholder="Kapasitas (0 = tutup)"
                value={draft.capacity}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    capacity: e.target.value.replace(/\D/g, ""),
                  }))
                }
              />
              <Button
                size="sm"
                onClick={handleAddOverride}
                disabled={createMutation.isPending || draftIncomplete || draftRangeInvalid}
              >
                {createMutation.isPending ? "Menambah…" : "Tambah Override"}
              </Button>
            </div>
            {draftRangeInvalid ? (
              <p className="text-xs text-red-600">
                Tanggal akhir tidak boleh sebelum tanggal mulai
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Override menang atas default. Kapasitas 0 = tanggal tutup
                (online & loket). Rentang yang tumpang tindih → kapasitas
                terkecil yang berlaku.
              </p>
            )}

            {capacityQuery.isLoading ? (
              <p className="py-3 text-center text-sm text-gray-500">
                Memuat override…
              </p>
            ) : overrides.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500">
                Belum ada override — semua tanggal memakai kapasitas default
              </p>
            ) : (
              overrides.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {row.label}
                      {row.capacity === 0 ? (
                        <Badge className="ml-2 border-0 bg-red-100 font-normal text-red-700">
                          Tutup
                        </Badge>
                      ) : (
                        <Badge className="ml-2 border-0 bg-blue-100 font-normal text-blue-700">
                          {formatNumber(row.capacity)} orang
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatDate(row.start_date)}
                      {row.end_date !== row.start_date
                        ? ` – ${formatDate(row.end_date)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={row.is_active}
                      disabled={updateMutation.isPending}
                      onCheckedChange={(checked) =>
                        updateMutation.mutate({
                          id: row.id,
                          values: { is_active: checked },
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus override ${row.label}`}
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(row.id)}
                    >
                      <Trash2 className="h-4 w-4 text-gray-400" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </PurchasingListSection>
  );
}
