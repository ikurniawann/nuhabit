export function summarizeVoidRows(rows: Array<{ total_amount: number }>) {
  return {
    voids: rows.length,
    amount: rows.reduce((sum, row) => {
      const n = Number(row.total_amount);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0),
  };
}

export function displayActorName(name?: string | null, fallback = "Tidak diketahui") {
  const trimmed = String(name || "").trim();
  return trimmed || fallback;
}
