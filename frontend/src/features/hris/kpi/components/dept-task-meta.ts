import type { DeptOccurrenceStatus, DeptTaskRecurrence } from "../types";

export const HARI = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

export const RECURRENCE_LABEL: Record<DeptTaskRecurrence, string> = {
  once: "Sekali",
  daily: "Harian",
  weekly: "Mingguan",
  monthly: "Bulanan",
};

export const OCCURRENCE_STATUS_META: Record<DeptOccurrenceStatus, { label: string; cls: string }> = {
  pending: { label: "Belum", cls: "bg-gray-100 text-gray-600" },
  done: { label: "Selesai — tunggu review Head", cls: "bg-blue-100 text-blue-700" },
  approved: { label: "Disetujui", cls: "bg-green-100 text-green-700" },
  rejected: { label: "Ditolak", cls: "bg-red-100 text-red-700" },
};

// Seksi daftar task (owner 2026-08-31): dipisah per jenis pengulangan,
// tiap seksi berwarna beda supaya mudah dipindai.
export const SECTION_ORDER = [
  { key: "daily", label: "Harian", cls: "bg-blue-50 text-blue-700 border-blue-100", titleCls: "text-blue-800" },
  { key: "weekly", label: "Mingguan", cls: "bg-emerald-50 text-emerald-700 border-emerald-100", titleCls: "text-emerald-800" },
  { key: "monthly", label: "Bulanan", cls: "bg-violet-50 text-violet-700 border-violet-100", titleCls: "text-violet-800" },
  { key: "once", label: "Task Tambahan", cls: "bg-amber-50 text-amber-700 border-amber-100", titleCls: "text-amber-800" },
] as const;
