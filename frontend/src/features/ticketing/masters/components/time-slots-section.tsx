"use client";

// EPIC-031 Fase D — pengaturan Timed-Entry: template slot waktu venue +
// toleransi jam masuk (grace) saat redeem. Venue tanpa slot aktif =
// booking online tanpa langkah pilih jam (perilaku lama).

import { useState } from "react";
import { ClockIcon } from "@heroicons/react/24/outline";
import { Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/format";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import {
  useCreateTimeSlot,
  useDeleteTimeSlot,
  useTicketingSettings,
  useTimeSlots,
  useUpdateSettings,
  useUpdateTimeSlot,
} from "../queries";

interface SlotForm {
  label: string;
  start_time: string;
  end_time: string;
  capacity: string;
}

const EMPTY_SLOT: SlotForm = {
  label: "",
  start_time: "",
  end_time: "",
  capacity: "",
};

export function TimeSlotsSection() {
  const settingsQuery = useTicketingSettings();
  const slotsQuery = useTimeSlots();
  const updateSettings = useUpdateSettings();
  const [draft, setDraft] = useState<SlotForm>(EMPTY_SLOT);
  const createMutation = useCreateTimeSlot(() => setDraft(EMPTY_SLOT));
  const updateMutation = useUpdateTimeSlot();
  const deleteMutation = useDeleteTimeSlot();

  const [graceEdit, setGraceEdit] = useState<string | null>(null);
  const settings = settingsQuery.data;
  const graceValue =
    graceEdit ??
    (settings === undefined ? "" : String(settings.slot_grace_minutes));

  const draftWindowInvalid =
    draft.start_time !== "" &&
    draft.end_time !== "" &&
    draft.end_time <= draft.start_time;
  const draftIncomplete =
    draft.label.trim() === "" || draft.start_time === "" || draft.end_time === "";

  const handleSaveGrace = () => {
    if (updateSettings.isPending || graceValue.trim() === "") return;
    updateSettings.mutate({
      slot_grace_minutes: Math.min(240, Number(graceValue) || 0),
    });
  };

  const handleAddSlot = () => {
    if (createMutation.isPending || draftIncomplete || draftWindowInvalid) return;
    const capacityTrimmed = draft.capacity.trim();
    createMutation.mutate({
      label: draft.label.trim(),
      start_time: draft.start_time,
      end_time: draft.end_time,
      // Kosong = tanpa batas per-slot (jendela jam saja)
      capacity: capacityTrimmed === "" ? null : Math.max(1, Number(capacityTrimmed) || 0),
    });
  };

  const slots = slotsQuery.data ?? [];

  return (
    <PurchasingListSection
      icon={ClockIcon}
      title="Slot Waktu (Timed-Entry)"
      description="Booking online wajib pilih jam kunjungan bila venue punya slot aktif. Tanpa slot = booking sepanjang hari seperti biasa."
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
              <Label htmlFor="slot_grace">Toleransi Jam Masuk (menit)</Label>
              <div className="flex gap-2">
                <Input
                  id="slot_grace"
                  type="number"
                  min={0}
                  max={240}
                  value={graceValue}
                  onChange={(e) =>
                    setGraceEdit(e.target.value.replace(/\D/g, ""))
                  }
                />
                <Button
                  size="sm"
                  onClick={handleSaveGrace}
                  disabled={updateSettings.isPending || graceValue.trim() === ""}
                >
                  {updateSettings.isPending ? "Menyimpan…" : "Simpan"}
                </Button>
              </div>
              <p className="text-xs text-gray-500">
                Booking ber-slot bisa di-redeem loket dari {graceValue || 0}{" "}
                menit sebelum jam mulai s/d {graceValue || 0} menit setelah jam
                selesai. Di luar itu petugas mendapat penolakan jelas.
              </p>
            </div>
            <p className="text-xs text-gray-500">
              Mengubah/menghapus template tidak mengubah booking yang sudah
              dibuat — jam slot di-simpan permanen di tiap booking.
            </p>
          </div>

          <div className="space-y-3">
            <Label>Daftar Slot</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                className="col-span-2"
                placeholder="Label — mis. Sesi Pagi"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              />
              <Input
                type="time"
                aria-label="Jam mulai"
                value={draft.start_time}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, start_time: e.target.value }))
                }
              />
              <Input
                type="time"
                aria-label="Jam selesai"
                aria-invalid={draftWindowInvalid}
                value={draft.end_time}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, end_time: e.target.value }))
                }
              />
              <Input
                type="number"
                min={1}
                placeholder="Kuota slot (kosong = tanpa batas)"
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
                onClick={handleAddSlot}
                disabled={createMutation.isPending || draftIncomplete || draftWindowInvalid}
              >
                {createMutation.isPending ? "Menambah…" : "Tambah Slot"}
              </Button>
            </div>
            {draftWindowInvalid ? (
              <p className="text-xs text-red-600">
                Jam selesai harus setelah jam mulai
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Kuota slot melengkapi (bukan menggantikan) kuota harian venue —
                keduanya ditegakkan saat booking.
              </p>
            )}

            {slotsQuery.isLoading ? (
              <p className="py-3 text-center text-sm text-gray-500">
                Memuat slot…
              </p>
            ) : slots.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500">
                Belum ada slot — booking online tanpa langkah pilih jam
              </p>
            ) : (
              slots.map((slot) => (
                <div
                  key={slot.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {slot.label}
                      <Badge className="ml-2 border-0 bg-blue-100 font-normal text-blue-700">
                        {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}
                      </Badge>
                      {slot.capacity !== null ? (
                        <Badge className="ml-1 border-0 bg-gray-100 font-normal text-gray-600">
                          {formatNumber(slot.capacity)} orang
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={slot.is_active}
                      disabled={updateMutation.isPending}
                      onCheckedChange={(checked) =>
                        updateMutation.mutate({
                          id: slot.id,
                          values: { is_active: checked },
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus slot ${slot.label}`}
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(slot.id)}
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
