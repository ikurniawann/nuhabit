"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { MONTH_NAMES_ID } from "@/lib/hris/month-label";
import { useCreatePayrollRun } from "../mutations";

const currentPeriod = () => ({ month: new Date().getMonth() + 1, year: new Date().getFullYear() });

export function NewPayrollDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [period, setPeriod] = useState(currentPeriod);
  const createMutation = useCreatePayrollRun();

  function handleCreate() {
    createMutation.mutate(
      { period_month: period.month, period_year: period.year },
      {
        onSuccess: () => {
          onOpenChange(false);
          setPeriod(currentPeriod());
          toast.success("✅ Payroll run berhasil dibuat");
        },
        onError: (error) => toast.error(error.message || "Gagal membuat payroll"),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buat Payroll Baru</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bulan</label>
            <Select
              value={String(period.month)}
              onValueChange={(v) => setPeriod((p) => ({ ...p, month: parseInt(v, 10) }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih bulan" />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES_ID.map((name, index) => (
                  <SelectItem key={name} value={String(index + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tahun</label>
            <Input
              type="number"
              value={period.year}
              onChange={(e) => setPeriod((p) => ({ ...p, year: parseInt(e.target.value, 10) }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="bg-pink-600 hover:bg-pink-700"
          >
            {createMutation.isPending ? "Membuat..." : "Buat Payroll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CalculateConfirmDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (includeThr: boolean) => void;
}) {
  const [includeThr, setIncludeThr] = useState(false);

  const close = () => {
    setIncludeThr(false);
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Konfirmasi Perhitungan Payroll</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <p className="text-sm text-gray-600">
            Apakah Anda yakin ingin menghitung payroll untuk periode ini?
          </p>

          <div className="flex items-center space-x-2 border rounded-lg p-3 bg-gray-50">
            <input
              type="checkbox"
              id="include-thr"
              checked={includeThr}
              onChange={(e) => setIncludeThr(e.target.checked)}
              className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
            />
            <label htmlFor="include-thr" className="text-sm font-medium text-gray-700 cursor-pointer">
              Include THR (Tunjangan Hari Raya)
            </label>
          </div>

          {includeThr && (
            <div className="text-xs text-gray-500 bg-yellow-50 border border-yellow-200 rounded p-2">
              ℹ️ THR akan ditambahkan sebesar 1x gaji pokok untuk karyawan yang sudah bekerja ≥ 1 tahun
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Batal
          </Button>
          <Button
            onClick={() => {
              onConfirm(includeThr);
              setIncludeThr(false);
            }}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Hitung Payroll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface CalculationResult {
  count: number;
  employees: string[];
}

export function CalculationResultDialog({
  calculating,
  result,
  onClose,
}: {
  calculating: boolean;
  result: CalculationResult | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={calculating || result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{calculating ? "Menghitung Payroll..." : "Hasil Perhitungan"}</DialogTitle>
        </DialogHeader>

        {calculating ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600" />
            <p className="text-gray-600">Sedang menghitung payroll untuk semua karyawan...</p>
          </div>
        ) : result ? (
          <div className="py-4 space-y-4">
            <div className="flex items-center justify-center space-x-2 text-green-600">
              <CheckCircleIcon className="w-8 h-8" />
              <span className="text-lg font-semibold">Perhitungan Berhasil!</span>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-2">Karyawan yang dihitung:</p>
              <p className="text-2xl font-bold text-green-700">{result.count} Karyawan</p>

              {result.employees.length > 0 && (
                <div className="mt-3 space-y-1">
                  {result.employees.map((name, idx) => (
                    <div key={idx} className="text-sm text-gray-700 flex items-center">
                      <CheckCircleIcon className="w-4 h-4 mr-2 text-green-600" />
                      {name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={onClose} className="bg-pink-600 hover:bg-pink-700">
                Tutup
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
