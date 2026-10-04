/**
 * Terbilang rupiah untuk dokumen kontrak — "Rp 4.500.000,- (empat juta lima
 * ratus ribu rupiah)". Mendukung sampai triliun; pecahan diabaikan.
 */

const SATUAN = [
  "", "satu", "dua", "tiga", "empat", "lima",
  "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas",
];

function terbilang(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${terbilang(n - 10)} belas`;
  if (n < 100) return `${terbilang(Math.floor(n / 10))} puluh ${terbilang(n % 10)}`.trim();
  if (n < 200) return `seratus ${terbilang(n - 100)}`.trim();
  if (n < 1000) return `${terbilang(Math.floor(n / 100))} ratus ${terbilang(n % 100)}`.trim();
  if (n < 2000) return `seribu ${terbilang(n - 1000)}`.trim();
  if (n < 1_000_000)
    return `${terbilang(Math.floor(n / 1000))} ribu ${terbilang(n % 1000)}`.trim();
  if (n < 1_000_000_000)
    return `${terbilang(Math.floor(n / 1_000_000))} juta ${terbilang(n % 1_000_000)}`.trim();
  if (n < 1_000_000_000_000)
    return `${terbilang(Math.floor(n / 1_000_000_000))} miliar ${terbilang(n % 1_000_000_000)}`.trim();
  return `${terbilang(Math.floor(n / 1_000_000_000_000))} triliun ${terbilang(n % 1_000_000_000_000)}`.trim();
}

export function terbilangRupiah(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "nol rupiah";
  const words = terbilang(Math.floor(amount)).replace(/\s+/g, " ").trim();
  return `${words} rupiah`;
}
