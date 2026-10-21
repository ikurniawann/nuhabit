/**
 * Bentuk respons Go /api/dashboard/executive (EPIC-021) untuk super_admin +
 * direksi: denyut hari ini (identik dengan papan desktop) plus tren 14 hari,
 * produk terlaris, nilai persediaan, purchasing bulan berjalan, payroll
 * terakhir, kontrak mendekati habis, dan denyut gym.
 */
import type { DesktopOverview } from "@/lib/desktop/overview";

export interface TrendPoint {
  tanggal: string;
  omzet: number;
  pesanan: number;
}

export interface TopProduct {
  produk: string;
  qty: number;
  omzet: number;
}

export interface PurchasingMonth {
  jumlahPo: number;
  nilaiTotal: number;
  perStatus: Array<{ status: string; jumlah: number }>;
}

export interface PayrollLast {
  runName: string;
  periode: string;
  status: string;
  totalNet: number;
  paidAt: string | null;
}

export interface OutletSales {
  outlet: string;
  omzetHariIni: number;
  pesananHariIni: number;
  omzet7Hari: number;
}

export interface MonthToDate {
  omzet: number;
  pesanan: number;
}

export interface GymSessionToday {
  id: string;
  kelas: string;
  coach: string | null;
  mulai: string;
  terisi: number;
  kapasitas: number;
  waitlist: number;
  status: string;
  /** Zona cabang kelas; "mulai" dibaca di zona ini. */
  timezone?: string;
}

/** Denyut gym hari ini: kelas, booking, check-in, kredit. */
export interface GymPulse {
  kelasHariIni: number;
  bookingHariIni: number;
  checkinHariIni: number;
  /** Persen kursi terisi (booking aktif ÷ kapasitas) dari kelas hari ini. */
  isiKelasPersen: number;
  waitlistHariIni: number;
  paketTerjual30Hari: number;
  pendapatanPaket30Hari: number;
  kreditBeredar: number;
  sesi: GymSessionToday[];
}

export interface ExecutiveDashboard {
  dibuatPada: string;
  /** Denyut hari ini: struktur identik dengan papan desktop. */
  overview: DesktopOverview;
  tren14Hari: TrendPoint[] | null;
  topProduk7Hari: TopProduct[] | null;
  nilaiPersediaan: number | null;
  purchasingBulanIni: PurchasingMonth | null;
  payrollTerakhir: PayrollLast | null;
  kontrakHabis30Hari: number | null;
  omzetPerOutlet: OutletSales[] | null;
  bulanBerjalan: MonthToDate | null;
  /** null bila skema gym belum dimigrasi. */
  gym: GymPulse | null;
  gagal: string[];
}
