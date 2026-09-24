/**
 * Helper murni untuk checklist stok opname (bahan baku & produk) — diuji unit.
 * Status baris: "belum" (qty fisik kosong), "sama", atau "selisih".
 */
export type OpnameLineStatus = "belum" | "sama" | "selisih";
export type OpnameFilter = "semua" | "belum" | "sudah" | "selisih";

export interface OpnameProgressLine {
  qtyInput: string;
  variance: number | null;
}

export function lineStatus(line: OpnameProgressLine): OpnameLineStatus {
  if (line.qtyInput.trim() === "") return "belum";
  if (line.variance === null || !Number.isFinite(line.variance) || line.variance === 0) return "sama";
  return "selisih";
}

export function matchesFilter(line: OpnameProgressLine, filter: OpnameFilter): boolean {
  const status = lineStatus(line);
  switch (filter) {
    case "belum": return status === "belum";
    case "sudah": return status !== "belum";
    case "selisih": return status === "selisih";
    default: return true;
  }
}

export function summarize(lines: OpnameProgressLine[]) {
  let belum = 0;
  let selisih = 0;
  for (const line of lines) {
    const s = lineStatus(line);
    if (s === "belum") belum += 1;
    else if (s === "selisih") selisih += 1;
  }
  const total = lines.length;
  const sudah = total - belum;
  return { total, sudah, belum, selisih, persen: total === 0 ? 0 : Math.round((sudah / total) * 100) };
}

/** Kunci baris berikutnya yang belum dihitung setelah `afterKey` (melingkar). */
export function nextUncountedKey<T extends OpnameProgressLine & { key: string }>(
  lines: T[],
  afterKey: string | null
): string | null {
  if (lines.length === 0) return null;
  const start = afterKey ? lines.findIndex((l) => l.key === afterKey) : -1;
  for (let i = 1; i <= lines.length; i += 1) {
    const line = lines[(start + i) % lines.length];
    if (line.key !== afterKey && lineStatus(line) === "belum") return line.key;
  }
  return null;
}
