/**
 * Nominal buku besar/laporan akuntansi: selalu 2 desimal ("1.250.000,00") agar
 * debit, kredit, dan saldo sejajar per kolom. Pengecualian sengaja dari
 * formatNumber (@/lib/format) yang tidak memaksa desimal.
 */
export function formatLedgerAmount(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
