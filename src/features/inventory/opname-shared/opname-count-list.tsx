"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { CheckCircleIcon as CheckCircleSolid } from "@heroicons/react/24/solid";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  lineStatus,
  matchesFilter,
  nextUncountedKey,
  summarize,
  type OpnameFilter,
} from "./opname-progress";

/**
 * Daftar item stok opname — dipakai bahan baku & produk, halaman hitung & riwayat.
 *
 * Mobile (< md): kartu per item, satu kolom, tanpa geser: nama, stok sistem,
 * input qty besar (keypad desimal), selisih, tombol "= sistem", dan tanda
 * checklist. Setelah Enter, fokus lompat ke item berikutnya yang belum dihitung.
 * Desktop (≥ md): tabel seperti semula + kolom checklist.
 * Keduanya: chip filter Semua / Belum / Sudah / Selisih + bilah progres.
 */
export interface OpnameCountItem {
  key: string;
  code: string;
  name: string;
  /** Baris kedua di bawah nama, mis. varian SKU. */
  subtitle?: string | null;
  /** Teks satuan, atau kontrol pemilih satuan (bahan baku). */
  unit: ReactNode;
  qtySystem: number;
  qtyInput: string;
  variance: number | null;
}

interface OpnameCountListProps {
  items: OpnameCountItem[];
  nameLabel: string;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  readOnly?: boolean;
  busy?: boolean;
  loading?: boolean;
  emptyText: string;
  onQtyChange?: (key: string, value: string) => void;
  /** Isi qty fisik satu baris dengan stok sistem. */
  onFillSystem?: (key: string) => void;
}

const FILTERS: { value: OpnameFilter; label: string }[] = [
  { value: "semua", label: "Semua" },
  { value: "belum", label: "Belum" },
  { value: "sudah", label: "Sudah" },
  { value: "selisih", label: "Selisih" },
];

function formatQty(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function Variance({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400">—</span>;
  if (value === 0) return <span className="text-emerald-600">0</span>;
  if (value > 0) return <span className="font-medium text-emerald-600">+{formatQty(value)}</span>;
  return <span className="font-medium text-red-600">{formatQty(value)}</span>;
}

function StatusMark({ status }: { status: ReturnType<typeof lineStatus> }) {
  if (status === "belum") {
    return (
      <span className="inline-block size-5 rounded-full border-2 border-gray-300" aria-label="Belum dihitung" title="Belum dihitung" />
    );
  }
  return (
    <CheckCircleSolid
      className={cn("size-5", status === "selisih" ? "text-amber-500" : "text-emerald-600")}
      aria-label={status === "selisih" ? "Sudah dihitung, ada selisih" : "Sudah dihitung"}
    />
  );
}

export function OpnameCountList({
  items,
  nameLabel,
  search,
  onSearchChange,
  searchPlaceholder,
  readOnly = false,
  busy = false,
  loading = false,
  emptyText,
  onQtyChange,
  onFillSystem,
}: OpnameCountListProps) {
  const [filter, setFilter] = useState<OpnameFilter>("semua");
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  const stats = useMemo(() => summarize(items), [items]);
  const counts = useMemo(
    () => ({
      semua: items.length,
      belum: stats.belum,
      sudah: stats.sudah,
      selisih: stats.selisih,
    }),
    [items.length, stats]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        matchesFilter(item, filter) &&
        (!q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q) || (item.subtitle ?? "").toLowerCase().includes(q))
    );
  }, [items, filter, search]);

  const focusNext = (afterKey: string) => {
    const next = nextUncountedKey(visible, afterKey);
    if (!next) return;
    const el = inputRefs.current.get(next);
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const editable = !readOnly && Boolean(onQtyChange);

  return (
    <div className="space-y-3">
      {/* Progres + filter — lengket di atas saat menggulir di HP */}
      <div className="sticky top-0 z-10 -mx-4 space-y-3 border-b border-gray-200/70 bg-white/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:px-0 md:py-0">
        <div>
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>
              <span className="font-semibold text-gray-900">{stats.sudah}</span>/{stats.total} dihitung
              {stats.selisih > 0 ? <span className="text-amber-600"> · {stats.selisih} selisih</span> : null}
            </span>
            <span className="font-semibold tabular-nums text-gray-900">{stats.persen}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={stats.persen} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full rounded-full transition-all", stats.persen === 100 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${stats.persen}%` }} />
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f.value ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              )}
            >
              {f.label} <span className={cn("tabular-nums", filter === f.value ? "text-white/70" : "text-gray-400")}>{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 border-gray-200/80 pl-9"
            disabled={busy}
          />
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-gray-400">Memuat data...</p>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">
          {items.length === 0 ? emptyText : filter === "belum" && stats.belum === 0 ? "Semua item sudah dihitung 🎉" : "Data tidak ditemukan"}
        </p>
      ) : (
        <>
          {/* ── Mobile: kartu per item ── */}
          <ul className="space-y-2 md:hidden">
            {visible.map((item) => {
              const status = lineStatus(item);
              return (
                <li
                  key={item.key}
                  className={cn(
                    "rounded-xl border p-3 transition-colors",
                    status === "belum" ? "border-gray-200 bg-white" : status === "selisih" ? "border-amber-200 bg-amber-50/40" : "border-emerald-200 bg-emerald-50/40"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="pt-0.5"><StatusMark status={status} /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
                      <p className="truncate text-xs text-gray-500">
                        <span className="font-mono">{item.code}</span>
                        {item.subtitle ? ` · ${item.subtitle}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400">Satuan</span>
                      <span className="min-w-0 truncate">{item.unit}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-400">Sistem </span>
                      <span className="font-semibold tabular-nums text-gray-900">{formatQty(item.qtySystem)}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {editable ? (
                      <input
                        ref={(el) => {
                          if (el) inputRefs.current.set(item.key, el);
                          else inputRefs.current.delete(item.key);
                        }}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        enterKeyHint="next"
                        value={item.qtyInput}
                        onChange={(e) => onQtyChange?.(item.key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            focusNext(item.key);
                          }
                        }}
                        disabled={busy}
                        placeholder="Qty fisik"
                        aria-label={`Qty fisik ${item.name}`}
                        className="h-12 min-w-0 flex-1 rounded-lg border border-gray-200/80 bg-white px-3 text-right text-lg font-semibold tabular-nums outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 disabled:opacity-50"
                      />
                    ) : (
                      <div className="flex-1 text-right">
                        <span className="text-xs text-gray-400">Fisik </span>
                        <span className="text-lg font-semibold tabular-nums text-gray-900">{item.qtyInput === "" ? "—" : formatQty(Number(item.qtyInput))}</span>
                      </div>
                    )}
                    {editable && onFillSystem ? (
                      <button
                        type="button"
                        onClick={() => {
                          onFillSystem(item.key);
                          focusNext(item.key);
                        }}
                        disabled={busy}
                        className="h-12 shrink-0 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 active:bg-gray-100 disabled:opacity-50"
                        title="Isi dengan stok sistem"
                      >
                        = sistem
                      </button>
                    ) : null}
                    <div className="w-16 shrink-0 text-right text-sm">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Selisih</p>
                      <Variance value={item.variance} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* ── Desktop: tabel ── */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="w-10 px-3 py-3" aria-label="Status" />
                  <th className="px-3 py-3">Kode</th>
                  <th className="px-3 py-3">{nameLabel}</th>
                  <th className="px-3 py-3">Satuan</th>
                  <th className="px-3 py-3 text-right">Stok Sistem</th>
                  <th className="px-3 py-3 text-right">Qty Fisik</th>
                  <th className="px-3 py-3 text-right">Selisih</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const status = lineStatus(item);
                  return (
                    <tr key={item.key} className={cn("border-b border-gray-200/70 hover:bg-gray-50/80", status === "belum" ? "" : "bg-emerald-50/20")}>
                      <td className="px-3 py-3"><StatusMark status={status} /></td>
                      <td className="px-3 py-3 font-mono text-xs text-gray-600">{item.code}</td>
                      <td className="px-3 py-3 font-medium text-gray-900">
                        {item.name}
                        {item.subtitle ? <p className="mt-0.5 text-xs font-normal text-gray-400">{item.subtitle}</p> : null}
                      </td>
                      <td className="px-3 py-3 text-gray-600">{item.unit}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{formatQty(item.qtySystem)}</td>
                      <td className="px-3 py-3 text-right">
                        {editable ? (
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={item.qtyInput}
                            onChange={(e) => onQtyChange?.(item.key, e.target.value)}
                            disabled={busy}
                            className="ml-auto h-9 w-28 border-gray-200/80 text-right"
                            placeholder="—"
                            aria-label={`Qty fisik ${item.name}`}
                          />
                        ) : (
                          <span className="text-gray-700">{item.qtyInput === "" ? "—" : formatQty(Number(item.qtyInput))}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right"><Variance value={item.variance} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
