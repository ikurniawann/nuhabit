"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  activeWeightTotal,
  buildConfigDraft,
  configPayloadItems,
  type ConfigDraftItem,
} from "@/lib/kpi/ui-config";
import { useKpiConfig } from "../queries";
import { useSaveKpiConfig } from "../mutations";

/**
 * Konfigurasi KPI per DEPARTEMEN (owner 2026-08-31): HRD menceklis
 * indikator mana yang mempengaruhi KPI tiap departemen + bobotnya —
 * mis. absen dihitung utk Service, tidak utk Human Resources.
 * Departemen yang belum dikonfigurasi memakai bawaan (pemetaan peran
 * lama). Perubahan berlaku mulai snapshot bulan berikutnya; scorecard
 * final tidak pernah dihitung ulang.
 */

export function KpiConfigPage() {
  const configQuery = useKpiConfig();
  const departments = useMemo(() => configQuery.data?.departments ?? [], [configQuery.data]);
  const indicators = useMemo(() => configQuery.data?.indicators ?? [], [configQuery.data]);
  const mappings = useMemo(() => configQuery.data?.mappings ?? [], [configQuery.data]);
  const loading = configQuery.isLoading;
  const [selectedDept, setSelectedDept] = useState<string>("");
  const activeDept = selectedDept || departments[0]?.id || "";
  // Suntingan per departemen menimpa baseline dari mapping tersimpan; tanpa
  // effect sinkronisasi, pindah departemen tidak kehilangan suntingan.
  const [edits, setEdits] = useState<Record<string, Record<string, ConfigDraftItem>>>({});
  const saveMutation = useSaveKpiConfig();

  const indicatorIds = useMemo(() => indicators.map((ind) => ind.id), [indicators]);
  const deptConfigured = mappings.some((m) => m.department_id === activeDept);
  const draft = useMemo(
    () => buildConfigDraft(indicatorIds, mappings, activeDept, edits[activeDept]),
    [indicatorIds, mappings, activeDept, edits]
  );
  const totalWeight = activeWeightTotal(draft);

  const setDraftItem = (indicatorId: string, patch: Partial<ConfigDraftItem>) =>
    setEdits((prev) => ({
      ...prev,
      [activeDept]: {
        ...prev[activeDept],
        [indicatorId]: { ...draft[indicatorId], ...patch },
      },
    }));

  function handleSave() {
    saveMutation.mutate(
      { department_id: activeDept, items: configPayloadItems(indicatorIds, draft) },
      {
        onSuccess: (res) => {
          toast.success(res.message ?? "Tersimpan");
          setEdits((prev) => ({ ...prev, [activeDept]: {} }));
        },
        onError: (err) => toast.error(err.message || "Gagal menyimpan"),
      }
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <SlidersHorizontal className="h-6 w-6 text-brand-text" />
          Konfigurasi KPI Department
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Centang indikator yang mempengaruhi KPI tiap departemen beserta
          bobotnya. Perubahan berlaku mulai perhitungan bulan berikutnya —
          scorecard yang sudah final tidak berubah.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {departments.map((dept) => (
          <Button
            key={dept.id}
            size="sm"
            variant={dept.id === activeDept ? "default" : "outline"}
            onClick={() => setSelectedDept(dept.id)}
          >
            {dept.name}
          </Button>
        ))}
      </div>

      {!loading && activeDept && !deptConfigured ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Departemen ini belum punya konfigurasi sendiri — KPI-nya masih
          memakai bawaan sistem. Centang indikator lalu Simpan untuk
          mengaturnya.
        </p>
      ) : null}

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
          </CardContent>
        </Card>
      ) : configQuery.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            {configQuery.error.message || "Gagal memuat konfigurasi"}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {indicators.map((ind) => {
              const d = draft[ind.id] ?? { enabled: false, weight: "10" };
              return (
                <div key={ind.id} className="flex items-center gap-3 px-4 py-3">
                  <Checkbox
                    checked={d.enabled}
                    onCheckedChange={(v) => setDraftItem(ind.id, { enabled: v === true })}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {ind.name}
                      <span className="ml-2 text-xs text-gray-400">
                        {ind.unit ?? ""} ·{" "}
                        {ind.direction === "lower_better"
                          ? "makin rendah makin baik"
                          : ind.direction === "boolean"
                            ? "tercapai / tidak"
                            : "makin tinggi makin baik"}
                      </span>
                    </p>
                    {ind.description ? (
                      <p className="truncate text-xs text-gray-500">{ind.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={d.weight}
                      disabled={!d.enabled}
                      onChange={(e) => setDraftItem(ind.id, { weight: e.target.value })}
                      className="h-8 w-20 text-right"
                    />
                    <span className="text-xs text-gray-500">%</span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between rounded-lg border bg-white px-4 py-3">
        <p className="text-sm">
          Total bobot aktif:{" "}
          <span
            className={
              totalWeight === 100 ? "font-semibold text-emerald-600" : "font-semibold text-amber-600"
            }
          >
            {totalWeight}%
          </span>
          {totalWeight !== 100 ? (
            <span className="ml-2 text-xs text-gray-500">
              (tidak harus 100 — skor dinormalkan otomatis, tapi 100 paling mudah dibaca)
            </span>
          ) : null}
        </p>
        <Button onClick={handleSave} disabled={saveMutation.isPending || loading || !activeDept}>
          {saveMutation.isPending
            ? "Menyimpan…"
            : `Simpan ${departments.find((d) => d.id === activeDept)?.name ?? ""}`}
        </Button>
      </div>
    </div>
  );
}
