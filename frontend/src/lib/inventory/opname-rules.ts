import { ApiError } from "@/lib/api/auth";

/** Angka dari kolom numeric/teks; NaN dan null jadi 0. */
export function toQty(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type OpnameStatusHolder = { status: string };
type CountedLine = { qty_counted?: number | null; qty_variance?: number | null };

/** Opname selesai/dibatalkan tidak boleh diubah lagi. */
export function assertOpnameEditable(opname: OpnameStatusHolder): void {
  if (opname.status === "completed") {
    throw ApiError.badRequest("Stock opname yang sudah selesai tidak dapat diubah");
  }
  if (opname.status === "cancelled") {
    throw ApiError.badRequest("Stock opname yang dibatalkan tidak dapat diubah");
  }
}

/** Syarat menyelesaikan opname: belum selesai/dibatalkan dan semua baris sudah dihitung. */
export function assertOpnameCompletable(opname: OpnameStatusHolder & { lines: CountedLine[] }): void {
  if (opname.status === "completed") {
    throw ApiError.badRequest("Stock opname sudah diselesaikan sebelumnya");
  }
  if (opname.status === "cancelled") {
    throw ApiError.badRequest("Stock opname yang dibatalkan tidak dapat diselesaikan");
  }
  const uncounted = opname.lines.filter((line) => line.qty_counted == null).length;
  if (uncounted > 0) {
    throw ApiError.badRequest(`Masih ada ${uncounted} baris yang belum dihitung`);
  }
}

/** Qty hasil hitung + selisih terhadap stok sistem; null berarti belum dihitung. */
export function countedLineValues(qtyCounted: number | null, qtySystem: number) {
  if (qtyCounted === null) return { qty_counted: null, qty_variance: null };
  const counted = toQty(qtyCounted);
  return { qty_counted: counted, qty_variance: counted - qtySystem };
}

/** Rekap header: baris terhitung, baris berselisih, dan status berikutnya. */
export function summarizeOpnameCounts(status: string, lines: CountedLine[]) {
  const linesCounted = lines.filter((line) => line.qty_counted != null).length;
  const linesWithVariance = lines.filter(
    (line) => line.qty_variance != null && line.qty_variance !== 0
  ).length;
  return {
    lines_counted: linesCounted,
    lines_with_variance: linesWithVariance,
    status: status === "draft" && linesCounted > 0 ? "in_progress" : status,
  };
}

export function opnameListPagination(page: number, limit: number, total: number) {
  return { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) };
}
