"use client";

// Bagian form campaign untuk kanal gym: batasi kode ke paket kelas tertentu.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { gymCreditsApi } from "@/features/gym/credits/api";
import { TargetPicker } from "./target-picker";

export function GymPackageTargets({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const packages = useQuery({ queryKey: ["gym-credits", "packages"], queryFn: gymCreditsApi.packages, retry: false });
  const options = useMemo(
    () =>
      (packages.data?.packages ?? []).map((p) => ({
        id: p.id,
        label: p.status === "archived" ? `${p.name} (diarsipkan)` : p.name,
      })),
    [packages.data]
  );

  return (
    <div className="space-y-3 rounded-xl bg-surface-2 p-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Paket kelas gym</p>
        <p className="text-xs text-muted-foreground">
          Kosongkan agar kode berlaku untuk semua paket. Bila diisi, kode ditolak untuk paket lain dan di luar
          pembelian paket gym.
        </p>
      </div>
      {packages.error ? (
        <p className="text-xs text-danger">Daftar paket gym tidak bisa dimuat: {packages.error.message}</p>
      ) : (
        <TargetPicker
          label="Paket"
          options={options}
          value={value}
          onChange={onChange}
          placeholder={packages.isLoading ? "Memuat paket…" : "Cari paket…"}
          disabled={disabled}
        />
      )}
    </div>
  );
}
