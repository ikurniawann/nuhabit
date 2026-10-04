export type HelpRole =
  | "kasir"
  | "supervisor"
  | "kepala_cabang"
  | "direksi"
  | "default";

type HelpEntry = Partial<Record<HelpRole, string>> & { default: string };

const HELP: Record<string, HelpEntry> = {
  "pos.shift": {
    default:
      "Buka shift sebelum bertransaksi. Semua penjualan Anda tercatat di bawah shift ini.",
    supervisor:
      "Pantau shift kasir aktif. Shift wajib dibuka sebelum transaksi dan ditutup saat tutup kasir.",
  },
  "pos.void": {
    default: "Membatalkan pesanan. Butuh otorisasi supervisor.",
    supervisor:
      "Masukkan PIN supervisor Anda untuk menyetujui pembatalan pesanan ini.",
    kepala_cabang:
      "Void memerlukan PIN supervisor; seluruh void tercatat di laporan untuk audit.",
  },
  "pos.split-bill": {
    default:
      "Split one bill into separate payments: equally across guests, or by assigning items to each guest.",
  },
  "pos.tax-toggle": {
    default:
      "Centang untuk menambahkan pajak (Tax) ke total transaksi ini.",
  },
  "pos.service-toggle": {
    default:
      "Centang untuk menambahkan Service Charge ke total transaksi ini.",
  },
  "pos.discount": {
    default:
      "Diskon otomatis mengikuti tier member (Silver 5%, Gold 10%, Platinum 15%).",
  },
  "report.closing.net-sales": {
    default: "Penjualan bersih = kotor − diskon − pajak − service charge.",
    kepala_cabang:
      "Bandingkan penjualan bersih terhadap target harian & bulanan cabang di bagian bawah laporan.",
    direksi:
      "Penjualan bersih lintas cabang menjadi dasar analisis margin di laporan profit.",
  },
  "appearance.mode": {
    default: "Auto mengikuti pengaturan terang/gelap perangkat Anda.",
  },
  "appearance.custom": {
    default:
      "Tema warna, sidebar, navbar, dan font disimpan per company. Preview dulu, lalu Apply.",
  },
  "pos.dashboard.aov": {
    default:
      "Average Order Value (AOV) = total pendapatan ÷ jumlah pesanan. Metrik ini menunjukkan rata-rata nilai belanja per transaksi.",
    kepala_cabang:
      "AOV yang meningkat menandakan up-selling atau paket bundling berhasil. Bandingkan dengan target bulanan cabang.",
    direksi:
      "AOV lintas cabang digunakan untuk analisis performa program loyalitas dan strategi pricing.",
  },
  "pos.dashboard.active-cashiers": {
    default:
      "Jumlah kasir yang memiliki minimal satu transaksi pada periode yang dipilih.",
    kepala_cabang:
      "Pantau kasir aktif vs total kasir terdaftar untuk mengukur efektivitas penugasan shift.",
    direksi:
      "Aktivitas kasir per cabang dapat dilihat di laporan operasional untuk perencanaan SDM.",
  },
  "report.closing.target-daily": {
    default: "Target omset untuk satu hari operasional ini.",
    kepala_cabang:
      "Bandingkan aktual vs target harian untuk memantau performa shift hari ini.",
  },
  "report.closing.target-monthly": {
    default: "Target omset untuk keseluruhan bulan berjalan.",
    kepala_cabang:
      "Gunakan target bulanan untuk memproyeksikan apakah cabang on-track di akhir bulan.",
    direksi:
      "Target bulanan per cabang menjadi dasar evaluasi kinerja operasional periode ini.",
  },
  "report.closing.target-mtd": {
    default: "Akumulasi aktual & target dari tanggal 1 sampai hari ini.",
    kepala_cabang:
      "MTD menunjukkan seberapa jauh cabang dari target bulanan pada hari ini.",
  },
};

export function getHelpText(helpId: string, role: HelpRole): string | null {
  const entry = HELP[helpId];
  if (!entry) return null;
  return entry[role] ?? entry.default;
}
