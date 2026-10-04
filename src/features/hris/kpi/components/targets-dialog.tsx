"use client";

import { useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { formatNumber } from "@/lib/format";
import { MONTH_SHORT_ID } from "@/lib/hris/month-label";
import { useKpiTargets } from "../queries";
import { useCreateKpiTarget, useDeleteKpiTarget } from "../mutations";
import type { KpiIndicatorInfo, KpiTargetRowUI } from "../types";

const SCOPE_GLOBAL = "global";
const PERIOD_ALL = "all";

function scopeLabel(row: KpiTargetRowUI): string {
  if (row.employee) return `Karyawan: ${row.employee.full_name}`;
  if (row.department) return `Dept: ${row.department.name}`;
  if (row.role_code) return `Role: ${row.role_code}`;
  return "Umum";
}

function periodLabelOf(row: KpiTargetRowUI): string {
  if (row.period_year && row.period_month)
    return `${MONTH_SHORT_ID[row.period_month]} ${row.period_year}`;
  if (row.period_year) return String(row.period_year);
  if (row.period_month) return `${MONTH_SHORT_ID[row.period_month]} (tiap tahun)`;
  return "Berlaku umum";
}

/**
 * Dialog "Atur Target" (EPIC-010 Fase D): daftar target aktif + form tambah.
 * Resolusi: karyawan > department > role > umum; bulan-eksak > tahun > umum.
 * Scope karyawan bisa dibuat via API; UI v1 menyediakan role/dept/umum.
 */
export function KpiTargetsDialog({
  open,
  onOpenChange,
  indicators,
  roleCodes,
  departments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indicators: KpiIndicatorInfo[];
  roleCodes: string[];
  departments: { id: string; name: string }[];
}) {
  const [indicatorCode, setIndicatorCode] = useState("");
  const [scopeType, setScopeType] = useState<string>(SCOPE_GLOBAL);
  const [scopeValue, setScopeValue] = useState("");
  const [periodMode, setPeriodMode] = useState<string>(PERIOD_ALL);
  const [periodMonth, setPeriodMonth] = useState(new Date().getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(new Date().getFullYear());
  const [targetValue, setTargetValue] = useState("");

  const targetsQuery = useKpiTargets(open);
  const targets = targetsQuery.data ?? [];
  const createMutation = useCreateKpiTarget();
  const deleteMutation = useDeleteKpiTarget();

  const selectedIndicator = indicators.find((i) => i.code === indicatorCode);
  const isPercentUnit =
    selectedIndicator?.unit === "%" || selectedIndicator?.unit === "rasio";
  const parsedInput = Number(targetValue.replace(",", "."));
  // Utk %/rasio input SELALU dalam persen (deterministik — bukan tebakan
  // magnitudo): 95 → 0.95, 0,5 → 0.005. Preview ditampilkan sebelum simpan.
  const normalizedPreview =
    Number.isFinite(parsedInput) && parsedInput >= 0
      ? isPercentUnit
        ? parsedInput / 100
        : parsedInput
      : null;

  async function submit() {
    const indicator = selectedIndicator;
    if (!indicator) {
      toast.error("Pilih indikator");
      return;
    }
    if (normalizedPreview === null) {
      toast.error("Isi nilai target yang valid");
      return;
    }
    const normalized = normalizedPreview;

    try {
      await createMutation.mutateAsync({
        indicator_id: indicator.id,
        target: normalized,
        period_year:
          periodMode === PERIOD_ALL ? null : periodYear,
        period_month:
          periodMode === "month" ? periodMonth : null,
        role_code: scopeType === "role" ? scopeValue || null : null,
        department_id: scopeType === "department" ? scopeValue || null : null,
      });
      setTargetValue("");
      toast.success("Target tersimpan");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan target");
    }
  }

  async function remove(id: string) {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("Target dihapus");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus target");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Atur Target KPI</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label>Indikator</Label>
              <Select value={indicatorCode} onValueChange={setIndicatorCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih indikator" />
                </SelectTrigger>
                <SelectContent>
                  {indicators.map((indicator) => (
                    <SelectItem key={indicator.code} value={indicator.code}>
                      {indicator.name}
                      {indicator.unit ? ` (${indicator.unit})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Scope</Label>
              <Select
                value={scopeType}
                onValueChange={(value) => {
                  setScopeType(value);
                  setScopeValue("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SCOPE_GLOBAL}>Umum (semua)</SelectItem>
                  <SelectItem value="role">Per Role</SelectItem>
                  <SelectItem value="department">Per Department</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>
                {scopeType === "role"
                  ? "Role"
                  : scopeType === "department"
                    ? "Department"
                    : "—"}
              </Label>
              {scopeType === "role" ? (
                <Select value={scopeValue} onValueChange={setScopeValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roleCodes.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : scopeType === "department" ? (
                <Select value={scopeValue} onValueChange={setScopeValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((department) => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input disabled placeholder="Berlaku semua" />
              )}
            </div>

            <div className="space-y-1">
              <Label>Periode</Label>
              <Select value={periodMode} onValueChange={setPeriodMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PERIOD_ALL}>Berlaku umum</SelectItem>
                  <SelectItem value="year">Tahun tertentu</SelectItem>
                  <SelectItem value="month">Bulan tertentu</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              {periodMode === "month" && (
                <Select
                  value={String(periodMonth)}
                  onValueChange={(value) => setPeriodMonth(Number(value))}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_SHORT_ID.slice(1).map((label, index) => (
                      <SelectItem key={label} value={String(index + 1)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {periodMode !== PERIOD_ALL && (
                <Input
                  className="w-24"
                  type="number"
                  value={periodYear}
                  onChange={(event) => setPeriodYear(Number(event.target.value))}
                />
              )}
            </div>

            <div className="space-y-1">
              <Label>
                Nilai Target{isPercentUnit ? " (%)" : ""}
              </Label>
              <Input
                value={targetValue}
                onChange={(event) => setTargetValue(event.target.value)}
                placeholder={isPercentUnit ? "mis. 95 atau 0,5" : "mis. 5000000"}
              />
              {normalizedPreview !== null && targetValue !== "" && (
                <p className="text-xs text-muted-foreground">
                  Disimpan sebagai:{" "}
                  <span className="font-medium">
                    {isPercentUnit
                      ? `${formatNumber(parsedInput, 3)}% (rasio ${formatNumber(normalizedPreview, 4)})`
                      : formatNumber(normalizedPreview, 3)}
                  </span>
                </p>
              )}
            </div>
            <div className="flex items-end">
              <Button onClick={submit} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Menyimpan..." : "Tambah Target"}
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Indikator</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    Belum ada target khusus — indikator memakai target default
                    sistem.
                  </TableCell>
                </TableRow>
              )}
              {targets.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.indicator?.name ?? row.indicator_id}</TableCell>
                  <TableCell>{scopeLabel(row)}</TableCell>
                  <TableCell>{periodLabelOf(row)}</TableCell>
                  <TableCell className="text-right">
                    {row.indicator?.unit === "%" || row.indicator?.unit === "rasio"
                      ? `${formatNumber(Number(row.target) * 100, 2)}%`
                      : formatNumber(row.target, 3)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => remove(row.id)}
                      aria-label="Hapus target"
                    >
                      <TrashIcon className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
