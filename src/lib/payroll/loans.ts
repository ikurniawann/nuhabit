/**
 * Logika murni cicilan pinjaman karyawan (EPIC-008 Fase D).
 * - Pinjaman jatuh tempo: approved, aktif, ada sisa, dan cicilan pertama
 *   sudah/berjalan pada periode payroll.
 * - Potongan per periode = Σ min(cicilan bulanan, sisa) per pinjaman due.
 * - Alokasi pembayaran saat run PAID: urut pinjaman tertua dulu, per
 *   pinjaman maksimal min(cicilan, sisa), total dibatasi nominal terpotong.
 */

import { formatRupiah } from "@/lib/format";

export interface LoanDeductionRow {
  id: string;
  monthly_installment: number;
  remaining_balance: number;
  first_installment_month: number | null;
  first_installment_year: number | null;
  status: string;
  is_active: boolean;
  /** Dipakai hanya untuk rincian slip; boleh absen pada pemanggil lama. */
  principal_amount?: number;
  tenor_months?: number | null;
  loan_type?: string | null;
}

/** Rincian satu cicilan untuk ditampilkan di slip gaji. */
export interface LoanInstallmentDetail {
  loan_id: string;
  loan_type: string | null;
  /** Angsuran ke berapa, dihitung dari pokok yang sudah terbayar. */
  installment_no: number;
  tenor_months: number | null;
  amount: number;
  remaining_before: number;
  remaining_after: number;
}

export interface LoanAllocation {
  loanId: string;
  amount: number;
  newRemaining: number;
  paidOff: boolean;
}

/** Apakah pinjaman menagih cicilan pada periode (month, year)? */
export function isLoanDue(
  loan: LoanDeductionRow,
  periodMonth: number,
  periodYear: number
): boolean {
  if (loan.status !== "approved" || !loan.is_active) return false;
  if (Number(loan.remaining_balance) <= 0) return false;
  if (Number(loan.monthly_installment) <= 0) return false;
  const m = loan.first_installment_month;
  const y = loan.first_installment_year;
  if (!m || !y) return false;
  return y < periodYear || (y === periodYear && m <= periodMonth);
}

/** Total potongan cicilan seorang karyawan untuk satu periode payroll. */
export function loanDeductionForPeriod(
  loans: LoanDeductionRow[],
  periodMonth: number,
  periodYear: number
): number {
  return loans
    .filter((loan) => isLoanDue(loan, periodMonth, periodYear))
    .reduce(
      (acc, loan) =>
        acc +
        Math.min(
          Math.round(Number(loan.monthly_installment)),
          Math.round(Number(loan.remaining_balance))
        ),
      0
    );
}

/**
 * Alokasikan nominal yang terpotong di slip ke pinjaman-pinjaman due
 * (urutan pemanggil: tertua dulu). Nominal bisa berbeda dari hitungan
 * terkini bila run dihitung sebelum data pinjaman berubah: karena itu
 * dibatasi `amount` DAN sisa masing-masing pinjaman.
 */
export function allocateLoanPayment(
  loans: LoanDeductionRow[],
  amount: number
): LoanAllocation[] {
  const allocations: LoanAllocation[] = [];
  let remainingAmount = Math.round(amount);
  for (const loan of loans) {
    if (remainingAmount <= 0) break;
    const balance = Math.round(Number(loan.remaining_balance));
    if (balance <= 0) continue;
    const installment = Math.round(Number(loan.monthly_installment));
    const pay = Math.min(installment, balance, remainingAmount);
    if (pay <= 0) continue;
    const newRemaining = balance - pay;
    allocations.push({
      loanId: loan.id,
      amount: pay,
      newRemaining,
      paidOff: newRemaining <= 0,
    });
    remainingAmount -= pay;
  }
  return allocations;
}

/**
 * Validasi limit pinjaman (dipakai saat pengajuan & approval):
 * cicilan/bulan maks % dari gaji pokok + jumlah pinjaman aktif maks.
 * Return pesan error, atau null bila lolos.
 */
export function validateLoanLimits(params: {
  monthlyInstallment: number;
  baseSalary: number | null;
  maxInstallmentPercent: number;
  activeLoanCount: number;
  maxActiveLoans: number;
}): string | null {
  const {
    monthlyInstallment,
    baseSalary,
    maxInstallmentPercent,
    activeLoanCount,
    maxActiveLoans,
  } = params;

  if (activeLoanCount >= maxActiveLoans) {
    return `Karyawan sudah punya ${activeLoanCount} pinjaman aktif (maks ${maxActiveLoans})`;
  }
  if (baseSalary === null || baseSalary <= 0) {
    return "Karyawan belum punya struktur gaji aktif — atur gaji dulu sebelum mengajukan pinjaman";
  }
  const maxInstallment = (baseSalary * maxInstallmentPercent) / 100;
  if (monthlyInstallment > maxInstallment) {
    return (
      `Cicilan ${formatRupiah(monthlyInstallment)}/bulan melebihi batas ` +
      `${maxInstallmentPercent}% dari gaji pokok (maks ${formatRupiah(maxInstallment)})`
    );
  }
  return null;
}

/**
 * Rincian cicilan periode ini, satu baris per pinjaman yang jatuh tempo.
 *
 * `installment_no` diturunkan dari pokok yang sudah terbayar, bukan dari
 * selisih bulan, agar tetap benar ketika ada periode yang terlewat (payroll
 * telat dijalankan) atau ketika karyawan membayar di muka.
 */
export function loanInstallmentDetails(
  loans: LoanDeductionRow[],
  periodMonth: number,
  periodYear: number
): LoanInstallmentDetail[] {
  return loans
    .filter((loan) => isLoanDue(loan, periodMonth, periodYear))
    .map((loan) => {
      const installment = Math.round(Number(loan.monthly_installment));
      const remainingBefore = Math.round(Number(loan.remaining_balance));
      const amount = Math.min(installment, remainingBefore);
      const principal = Math.round(Number(loan.principal_amount ?? 0));

      // Berapa angsuran yang sudah lunas sebelum periode ini.
      const paidSoFar = Math.max(0, principal - remainingBefore);
      const installmentNo =
        installment > 0 ? Math.floor(paidSoFar / installment) + 1 : 1;

      return {
        loan_id: loan.id,
        loan_type: loan.loan_type ?? null,
        installment_no: installmentNo,
        tenor_months: loan.tenor_months ?? null,
        amount,
        remaining_before: remainingBefore,
        remaining_after: remainingBefore - amount,
      };
    });
}

/** Label jenis pinjaman untuk slip gaji. */
export const LOAN_TYPE_LABELS: Record<string, string> = {
  kasbon: "Kasbon",
  loan: "Pinjaman",
  emergency: "Pinjaman Darurat",
};

/**
 * Label baris potongan di slip, mis. "Cicilan Kasbon (2/3)".
 * Tenor bisa kosong pada data lama, jadi nomor angsuran hanya ditampilkan
 * bila tenornya diketahui: lebih baik tanpa keterangan daripada menyesatkan.
 */
export function loanInstallmentLabel(detail: LoanInstallmentDetail): string {
  const jenis = detail.loan_type
    ? LOAN_TYPE_LABELS[detail.loan_type] ?? detail.loan_type
    : "Pinjaman";
  return detail.tenor_months
    ? `Cicilan ${jenis} (${detail.installment_no}/${detail.tenor_months})`
    : `Cicilan ${jenis}`;
}

/**
 * Cicilan & total kewajiban pinjaman baru (bunga flat sederhana).
 * `rawInstallment` tidak dibulatkan dan dipakai validasi limit; yang
 * disimpan adalah `monthlyInstallment` (dibulatkan) dan `totalRepayment` =
 * cicilan bulat × tenor, sehingga cicilan mengikis saldo tepat ke 0.
 */
export function computeLoanTerms(params: {
  principal: number;
  ratePercent: number;
  tenorMonths: number;
}): { rawInstallment: number; monthlyInstallment: number; totalRepayment: number } {
  const { principal, ratePercent, tenorMonths } = params;
  const rawInstallment = ratePercent
    ? (principal * (1 + (ratePercent / 100) * tenorMonths)) / tenorMonths
    : principal / tenorMonths;
  const monthlyInstallment = Math.round(rawInstallment);
  return { rawInstallment, monthlyInstallment, totalRepayment: monthlyInstallment * tenorMonths };
}

/** Cicilan pertama mulai BULAN DEPAN dari tanggal persetujuan (waktu lokal server). */
export function firstInstallmentPeriod(approvedAt: Date): { month: number; year: number } {
  const next = new Date(approvedAt.getFullYear(), approvedAt.getMonth() + 1, 1);
  return { month: next.getMonth() + 1, year: next.getFullYear() };
}
