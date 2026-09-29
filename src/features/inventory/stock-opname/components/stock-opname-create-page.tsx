"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import {
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import {
  baseQtyFromInput,
  convertQtyInputBetweenModes,
  displayQtyInputFromBase,
  hasSmallUnit,
  toDisplayQty,
  type RawMaterialUnitInfo,
  type RawMaterialUnitMode,
} from "@/lib/inventory/raw-material-units";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { RawMaterialUnitSelect } from "./raw-material-unit-select";
import { OpnameCountList, type OpnameCountItem } from "@/features/inventory/opname-shared";
import { useStockOpname, useStockOpnamePreview, useStockOpnameWarehouses } from "../queries";
import {
  useCompleteStockOpname,
  useCreateStockOpname,
  useUpdateStockOpname,
} from "../mutations";
import { toast } from "sonner";

type CountLine = {
  key: string;
  lineId?: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  satuan_besar_nama: string | null;
  satuan_kecil_nama: string | null;
  konversi_factor: number | null;
  input_unit_mode: RawMaterialUnitMode;
  qty_system: number;
  qty_counted_input: string;
};

function lineUnitInfo(line: CountLine): RawMaterialUnitInfo {
  return {
    satuan: line.satuan,
    satuan_besar_nama: line.satuan_besar_nama,
    satuan_kecil_nama: line.satuan_kecil_nama,
    konversi_factor: line.konversi_factor,
  };
}

/**
 * Satuan hitung default untuk SEMUA bahan yang punya konversi (mis. Karung ↔
 * Kg). Dipilih sebelum mulai menghitung; masih bisa diubah per item. Diingat
 * di perangkat (localStorage) supaya petugas gudang tidak memilih ulang.
 */
const UNIT_MODE_STORAGE_KEY = "opname:unit-mode";

function readStoredUnitMode(): RawMaterialUnitMode {
  if (typeof window === "undefined") return "besar";
  try {
    return window.localStorage.getItem(UNIT_MODE_STORAGE_KEY) === "kecil" ? "kecil" : "besar";
  } catch {
    return "besar";
  }
}

function modeFor(info: RawMaterialUnitInfo, preferred: RawMaterialUnitMode): RawMaterialUnitMode {
  return preferred === "kecil" && hasSmallUnit(info) ? "kecil" : "besar";
}

interface StockOpnameCreatePageProps {
  opnameId?: string;
}

export function StockOpnameCreatePage({ opnameId }: StockOpnameCreatePageProps) {
  const router = useRouter();
  const isContinue = Boolean(opnameId);

  const warehousesQuery = useStockOpnameWarehouses();
  const detailQuery = useStockOpname(opnameId || "");
  const createMutation = useCreateStockOpname();
  const updateMutation = useUpdateStockOpname();
  const completeMutation = useCompleteStockOpname();

  const [warehouseId, setWarehouseId] = useState("");
  const [opnameDate, setOpnameDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [lines, setLines] = useState<CountLine[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [unitMode, setUnitMode] = useState<RawMaterialUnitMode>(readStoredUnitMode);

  const previewQuery = useStockOpnamePreview(
    !isContinue && warehouseId ? warehouseId : ""
  );

  const detail = detailQuery.data;
  const isEditableContinue =
    isContinue &&
    (detail?.status === "draft" || detail?.status === "in_progress");

  const isBusy =
    createMutation.isPending || updateMutation.isPending || completeMutation.isPending;

  const warehouseOptions = (warehousesQuery.data || []).map((w) => ({
    value: w.id,
    label: w.name,
    description: w.code,
  }));

  const selectedWarehouse = warehouseOptions.find((w) => w.value === warehouseId);

  useEffect(() => {
    if (!isContinue || !detail || initialized) return;

    if (detail.status === "completed" || detail.status === "cancelled") {
      router.replace(RM_ROUTES.inventoryOpnameDetail(detail.id));
      return;
    }

    setWarehouseId(detail.warehouse_id || "");
    setOpnameDate(detail.opname_date?.slice(0, 10) || opnameDate);
    setNotes(detail.notes || "");
    setLines(
      (detail.lines || []).map((line) => ({
        key: line.id,
        lineId: line.id,
        raw_material_id: line.raw_material_id,
        material_kode: line.material_kode || "",
        material_nama: line.material_nama || "",
        satuan: line.satuan ?? null,
        satuan_besar_nama: line.satuan_besar_nama ?? line.satuan ?? null,
        satuan_kecil_nama: line.satuan_kecil_nama ?? null,
        konversi_factor: line.konversi_factor ?? null,
        input_unit_mode: modeFor(
          { satuan: line.satuan, satuan_besar_nama: line.satuan_besar_nama ?? line.satuan, satuan_kecil_nama: line.satuan_kecil_nama, konversi_factor: line.konversi_factor },
          unitMode
        ),
        qty_system: line.qty_system,
        qty_counted_input: displayQtyInputFromBase(
          line.qty_counted,
          modeFor(
            { satuan: line.satuan, satuan_besar_nama: line.satuan_besar_nama ?? line.satuan, satuan_kecil_nama: line.satuan_kecil_nama, konversi_factor: line.konversi_factor },
            unitMode
          ),
          {
            satuan: line.satuan,
            satuan_besar_nama: line.satuan_besar_nama ?? line.satuan,
            satuan_kecil_nama: line.satuan_kecil_nama,
            konversi_factor: line.konversi_factor,
          }
        ),
      }))
    );
    setInitialized(true);
  }, [isContinue, detail, initialized, router, opnameDate, unitMode]);

  useEffect(() => {
    if (isContinue || !warehouseId || previewQuery.isLoading) return;

    const items = previewQuery.data ?? [];
    setLines(
      items.map((item) => ({
        key: item.raw_material_id,
        raw_material_id: item.raw_material_id,
        material_kode: item.material_kode,
        material_nama: item.material_nama,
        satuan: item.satuan,
        satuan_besar_nama: item.satuan_besar_nama ?? item.satuan ?? null,
        satuan_kecil_nama: item.satuan_kecil_nama ?? null,
        konversi_factor: item.konversi_factor ?? null,
        input_unit_mode: modeFor(
          { satuan: item.satuan, satuan_besar_nama: item.satuan_besar_nama ?? item.satuan, satuan_kecil_nama: item.satuan_kecil_nama, konversi_factor: item.konversi_factor },
          unitMode
        ),
        qty_system: item.qty_system,
        qty_counted_input: "",
      }))
    );
    // unitMode sengaja tidak jadi dependensi: ganti satuan setelah data ada
    // ditangani handleUnitModeAll (mengonversi input), bukan memuat ulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContinue, warehouseId, previewQuery.data, previewQuery.isLoading]);

  /** Ganti satuan hitung untuk semua bahan yang punya konversi; input yang sudah diisi dikonversi. */
  const handleUnitModeAll = (next: RawMaterialUnitMode) => {
    setUnitMode(next);
    try {
      window.localStorage.setItem(UNIT_MODE_STORAGE_KEY, next);
    } catch {
      /* penyimpanan lokal tidak tersedia — abaikan */
    }
    setLines((prev) =>
      prev.map((line) => {
        const info = lineUnitInfo(line);
        const target = modeFor(info, next);
        if (line.input_unit_mode === target) return line;
        return {
          ...line,
          input_unit_mode: target,
          qty_counted_input: convertQtyInputBetweenModes(line.qty_counted_input, line.input_unit_mode, target, info),
        };
      })
    );
  };
  const linesWithSmallUnit = lines.filter((line) => hasSmallUnit(lineUnitInfo(line))).length;

  const handleFillSystemLine = (key: string) => {
    setLines((prev) =>
      prev.map((line) =>
        line.key === key
          ? { ...line, qty_counted_input: displayQtyInputFromBase(line.qty_system, line.input_unit_mode, lineUnitInfo(line)) }
          : line
      )
    );
  };

  const countItems = useMemo<OpnameCountItem[]>(
    () =>
      lines.map((line) => {
        const unit = lineUnitInfo(line);
        const displaySystem = toDisplayQty(line.qty_system, line.input_unit_mode, unit);
        const counted = line.qty_counted_input === "" ? null : Number(line.qty_counted_input);
        return {
          key: line.key,
          code: line.material_kode,
          name: line.material_nama,
          unit: (
            <RawMaterialUnitSelect
              info={unit}
              value={line.input_unit_mode}
              onChange={(mode) => handleRowUnitModeChange(line.key, mode)}
              disabled={isBusy}
            />
          ),
          qtySystem: displaySystem,
          qtyInput: line.qty_counted_input,
          variance: counted === null || !Number.isFinite(counted) ? null : counted - displaySystem,
        };
      }),
    // handleRowUnitModeChange dibuat ulang tiap render; cukup lines & isBusy.
    [lines, isBusy]
  );

  const progress = useMemo(() => {
    const counted = lines.filter((line) => line.qty_counted_input !== "").length;
    const variance = lines.filter((line) => {
      if (line.qty_counted_input === "") return false;
      const base = baseQtyFromInput(
        line.qty_counted_input,
        line.input_unit_mode,
        lineUnitInfo(line)
      );
      return base !== null && base !== line.qty_system;
    }).length;
    return { counted, variance, total: lines.length };
  }, [lines]);

  const hasItems = lines.length > 0;
  const isPreviewLoading = !isContinue && !!warehouseId && previewQuery.isLoading;

  const handleWarehouseChange = (value: string) => {
    setWarehouseId(value);
    setItemSearch("");
    setLines([]);
  };

  const handleLineChange = (key: string, value: string) => {
    setLines((prev) =>
      prev.map((line) =>
        line.key === key ? { ...line, qty_counted_input: value } : line
      )
    );
  };

  const handleRowUnitModeChange = (key: string, next: RawMaterialUnitMode) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key || line.input_unit_mode === next) return line;
        return {
          ...line,
          input_unit_mode: next,
          qty_counted_input: convertQtyInputBetweenModes(
            line.qty_counted_input,
            line.input_unit_mode,
            next,
            lineUnitInfo(line)
          ),
        };
      })
    );
  };

  const handleFillSystem = () => {
    setLines((prev) =>
      prev.map((line) => ({
        ...line,
        qty_counted_input: displayQtyInputFromBase(
          line.qty_system,
          line.input_unit_mode,
          lineUnitInfo(line)
        ),
      }))
    );
  };

  const resolveBaseQty = (line: CountLine): number | null =>
    baseQtyFromInput(line.qty_counted_input, line.input_unit_mode, lineUnitInfo(line));

  const validateQtyInputs = (requireAll: boolean) => {
    if (requireAll) {
      const uncounted = lines.filter((line) => line.qty_counted_input === "");
      if (uncounted.length > 0) {
        toast.error(`${uncounted.length} baris belum dihitung`);
        return false;
      }
    }

    const invalid = lines.find((line) => {
      if (line.qty_counted_input === "") return false;
      const n = Number(line.qty_counted_input);
      return !Number.isFinite(n) || n < 0;
    });
    if (invalid) {
      toast.error("Qty fisik harus berupa angka lebih besar atau sama dengan nol");
      return false;
    }
    return true;
  };

  const buildLineUpdates = (lineRecords: { id: string; raw_material_id: string }[]) => {
    const byMaterial = new Map(lineRecords.map((l) => [l.raw_material_id, l.id]));
    return lines
      .filter((line) => line.qty_counted_input !== "")
      .map((line) => {
        const baseQty = resolveBaseQty(line);
        return {
          id: line.lineId || byMaterial.get(line.raw_material_id)!,
          qty_counted: baseQty ?? 0,
        };
      })
      .filter((line) => line.id);
  };

  const handleSaveDraft = async () => {
    if (!warehouseId) {
      toast.error("Pilih stall terlebih dahulu");
      return;
    }
    if (!hasItems) {
      toast.error("Tidak ada bahan baku yang tersedia untuk stok opname");
      return;
    }
    if (!validateQtyInputs(false)) return;

    try {
      if (isContinue && opnameId) {
        await updateMutation.mutateAsync({
          id: opnameId,
          input: {
            notes: notes.trim() || undefined,
            lines: lines.map((line) => ({
              id: line.lineId!,
              qty_counted: resolveBaseQty(line),
            })),
          },
        });
        toast.success("Draf stok opname berhasil disimpan");
        return;
      }

      const created = await createMutation.mutateAsync({
        warehouse_id: warehouseId,
        opname_date: opnameDate,
        notes: notes.trim() || undefined,
        reason: "stock_opname",
      });

      const updates = buildLineUpdates(
        (created.lines || []).map((l) => ({
          id: l.id,
          raw_material_id: l.raw_material_id,
        }))
      );

      if (updates.length > 0) {
        await updateMutation.mutateAsync({
          id: created.id,
          input: { lines: updates },
        });
      }

      toast.success("Draf stok opname berhasil disimpan");
      router.replace(RM_ROUTES.inventoryOpnameContinue(created.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan draf");
    }
  };

  const handleComplete = async () => {
    if (!warehouseId) {
      toast.error("Pilih stall terlebih dahulu");
      return;
    }
    if (!hasItems) {
      toast.error("Tidak ada bahan baku yang tersedia untuk stok opname");
      return;
    }
    if (!validateQtyInputs(true)) return;

    try {
      let sessionId = opnameId;

      if (!sessionId) {
        const created = await createMutation.mutateAsync({
          warehouse_id: warehouseId,
          opname_date: opnameDate,
          notes: notes.trim() || undefined,
          reason: "stock_opname",
        });
        sessionId = created.id;

        await updateMutation.mutateAsync({
          id: sessionId,
          input: {
            lines: lines.map((line) => {
              const createdLine = created.lines?.find(
                (l) => l.raw_material_id === line.raw_material_id
              );
              if (!createdLine) {
                throw new Error(`Baris tidak ditemukan untuk ${line.material_kode}`);
              }
              return {
                id: createdLine.id,
                qty_counted: resolveBaseQty(line) ?? 0,
              };
            }),
          },
        });
      } else {
        await updateMutation.mutateAsync({
          id: sessionId,
          input: {
            notes: notes.trim() || undefined,
            lines: lines.map((line) => ({
              id: line.lineId!,
              qty_counted: resolveBaseQty(line) ?? 0,
            })),
          },
        });
      }

      await completeMutation.mutateAsync(sessionId);
      toast.success("Stok opname berhasil diselesaikan dan persediaan telah disesuaikan");
      router.push(RM_ROUTES.inventoryOpnameDetail(sessionId!));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menyelesaikan stok opname"
      );
    }
  };

  const handleCancel = async () => {
    if (!opnameId || !window.confirm("Batalkan sesi stok opname ini?")) return;
    try {
      await updateMutation.mutateAsync({
        id: opnameId,
        input: { status: "cancelled" },
      });
      toast.success("Stok opname berhasil dibatalkan");
      router.push(RM_ROUTES.inventoryOpname);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membatalkan sesi");
    }
  };

  if (isContinue && detailQuery.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-gray-400">
        Memuat sesi stok opname...
      </div>
    );
  }

  if (isContinue && !isEditableContinue && detail) {
    return null;
  }

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      <PurchasingFormHeader
        backHref={RM_ROUTES.inventoryOpname}
        title={isContinue ? "Lanjutkan Stok Opname" : "Buat Stok Opname"}
        description="Pilih stall, masukkan qty fisik, lalu simpan sebagai draf atau selesaikan opname"
        actions={
          hasItems ? (
            <div className="hidden flex-wrap gap-2 md:flex">
              <Button
                type="button"
                variant="outline"
                className="purchasing-secondary-button"
                onClick={handleFillSystem}
                disabled={isBusy}
              >
                Isi dengan Stok Sistem
              </Button>
              {isContinue && (
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-200/80 text-red-700"
                  onClick={handleCancel}
                  disabled={isBusy}
                >
                  Batalkan Sesi
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="purchasing-secondary-button"
                onClick={handleSaveDraft}
                disabled={isBusy || !warehouseId}
              >
                {updateMutation.isPending && !completeMutation.isPending
                  ? "Menyimpan..."
                  : "Simpan Draf"}
              </Button>
              <Button
                type="button"
                className="purchasing-main-button"
                onClick={handleComplete}
                disabled={isBusy || !warehouseId}
              >
                {completeMutation.isPending ? "Memproses..." : "Selesaikan Opname"}
              </Button>
            </div>
          ) : undefined
        }
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Informasi Opname</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="min-w-0 space-y-1.5 md:col-span-4">
              <Label className="text-xs">
                Stall <span className="text-red-500">*</span>
              </Label>
              <Combobox
                value={warehouseId}
                onChange={handleWarehouseChange}
                options={warehouseOptions}
                placeholder={
                  warehousesQuery.isLoading ? "Memuat stall..." : "Pilih stall"
                }
                disabled={warehousesQuery.isLoading || isBusy || isContinue}
                className="w-full! h-9 border-gray-200/80 text-sm"
              />
            </div>

            <div className="min-w-0 md:col-span-3">
              <DsDateTimePicker
                label="Tanggal Opname"
                value={opnameDate}
                onChange={setOpnameDate}
                placeholder="Pilih tanggal opname..."
                dateOnly
                disabled={isBusy}
              />
            </div>

            <div className="min-w-0 space-y-1.5 md:col-span-5">
              <Label htmlFor="notes" className="text-xs">
                Catatan
              </Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan tambahan (opsional)..."
                disabled={isBusy}
                className="h-9 border-gray-200/80 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5 border-t border-gray-200/70 pt-4">
            <Label className="text-xs">Satuan hitung</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="inline-flex rounded-lg border border-gray-200/80 p-0.5" role="radiogroup" aria-label="Satuan hitung">
                {(
                  [
                    { value: "besar", label: "Satuan besar", hint: "mis. Karung, Dus" },
                    { value: "kecil", label: "Satuan kecil", hint: "mis. Kg, Pcs" },
                  ] as { value: RawMaterialUnitMode; label: string; hint: string }[]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={unitMode === opt.value}
                    disabled={isBusy}
                    onClick={() => handleUnitModeAll(opt.value)}
                    className={
                      "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:flex-none " +
                      (unitMode === opt.value ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50")
                    }
                  >
                    {opt.label}
                    <span className={"block text-[10px] font-normal " + (unitMode === opt.value ? "text-white/70" : "text-gray-400")}>{opt.hint}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                {hasItems
                  ? linesWithSmallUnit > 0
                    ? `Berlaku untuk ${linesWithSmallUnit} bahan yang punya konversi satuan; bahan lain tetap satuan dasarnya. Masih bisa diubah per item.`
                    : "Tidak ada bahan dengan konversi satuan di stall ini."
                  : "Pilih sebelum mulai menghitung; bisa diubah per item nanti."}
              </p>
            </div>
          </div>

          {hasItems && (
            <div className="grid grid-cols-3 gap-3 border-t border-gray-200/70 pt-4">
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Total Baris</p>
                <p className="text-lg font-bold text-gray-900">{progress.total}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Terhitung</p>
                <p className="text-lg font-bold text-amber-600">{progress.counted}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Ada Selisih</p>
                <p className="text-lg font-bold text-pink-600">{progress.variance}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {warehouseId && (
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Perhitungan Stok Fisik
                  {selectedWarehouse ? ` — ${selectedWarehouse.label}` : ""}
                </h2>
                <p className="text-sm text-gray-500">
                  {isPreviewLoading
                    ? "Memuat bahan baku..."
                    : hasItems
                      ? "Masukkan qty fisik dari hasil perhitungan stall"
                      : "Tidak ada bahan baku aktif di cabang stall ini"}
                </p>
              </div>
            </div>

            <div className="px-4 pb-4">
              <OpnameCountList
                items={countItems}
                nameLabel="Nama Bahan Baku"
                search={itemSearch}
                onSearchChange={setItemSearch}
                searchPlaceholder="Cari bahan baku..."
                busy={isBusy}
                loading={isPreviewLoading}
                emptyText="Pilih stall untuk memuat bahan baku"
                onQtyChange={handleLineChange}
                onFillSystem={handleFillSystemLine}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {hasItems && (
        <>
          {/* Aksi sekunder di HP — tombol utama ada di bilah bawah */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs md:hidden">
            <button type="button" className="text-gray-600 underline-offset-2 hover:underline disabled:opacity-50" onClick={handleFillSystem} disabled={isBusy}>
              Isi semua dengan stok sistem
            </button>
            {isContinue && (
              <button type="button" className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50" onClick={handleCancel} disabled={isBusy}>
                Batalkan sesi
              </button>
            )}
          </div>
          {/* Bilah aksi lengket di bawah — jempol tidak perlu menggulir ke atas */}
          <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-gray-200/70 bg-white/95 p-3 backdrop-blur md:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            <Button type="button" variant="outline" className="purchasing-secondary-button h-11 flex-1" onClick={handleSaveDraft} disabled={isBusy || !warehouseId}>
              {updateMutation.isPending && !completeMutation.isPending ? "Menyimpan..." : "Simpan Draf"}
            </Button>
            <Button type="button" className="purchasing-main-button h-11 flex-1" onClick={handleComplete} disabled={isBusy || !warehouseId}>
              {completeMutation.isPending ? "Memproses..." : "Selesaikan"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
