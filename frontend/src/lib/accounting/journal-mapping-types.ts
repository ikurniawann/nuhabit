export const JOURNAL_MODULES = [
  "POS",
  "PURCHASING",
  "PAYROLL",
  "PINJAMAN",
  "SALES",
  "INVENTORY",
] as const;
export type JournalModule = (typeof JOURNAL_MODULES)[number];

export const JOURNAL_ENTRY_SIDES = ["DEBIT", "CREDIT"] as const;
export type JournalEntrySide = (typeof JOURNAL_ENTRY_SIDES)[number];

export const JOURNAL_AMOUNT_SOURCES = [
  "TOTAL",
  "SUBTOTAL",
  "TAX",
  "COGS",
  "PAID",
  "DISCOUNT",
  "SERVICE_CHARGE",
] as const;
export type JournalAmountSource = (typeof JOURNAL_AMOUNT_SOURCES)[number];

export const JOURNAL_LINE_ROLES = [
  "CASH",
  "BANK",
  "REVENUE",
  "TAX",
  "COGS",
  "INVENTORY",
  "AP",
  "AR",
  "GRNI",
  "WALLET",
  "GIFT_CARD_LIABILITY",
  /** Uang muka / deposit cicilan Tagihan Member (kewajiban). */
  "MEMBER_DEPOSIT",
  "DISCOUNT",
  "SALARY_EXPENSE",
  "SALARY_PAYABLE",
  "LOAN_RECEIVABLE",
  "BPJS_EXPENSE",
  "BPJS_TK_PAYABLE",
  "BPJS_KES_PAYABLE",
  "TAPERA_EXPENSE",
  "TAPERA_PAYABLE",
  /** Barang dalam proses (produksi). */
  "WIP",
  /** Overhead pabrik dibebankan ke WIP. */
  "OVERHEAD_APPLIED",
  /** Kerugian produksi (scrap di atas toleransi). */
  "PRODUCTION_LOSS",
  /** Pendapatan diterima di muka dari paket kredit dan pass gym. */
  "GYM_DEFERRED_REVENUE",
  /** Pendapatan kelas gym dari kredit yang terpakai. */
  "GYM_CLASS_REVENUE",
  /** Pendapatan dari kredit gym yang kedaluwarsa. */
  "GYM_BREAKAGE_REVENUE",
  /** Pendapatan pass gym yang diakui per hari. */
  "GYM_PASS_REVENUE",
  "OTHER",
] as const;
export type JournalLineRole = (typeof JOURNAL_LINE_ROLES)[number];

export const JOURNAL_EVENT_CODES = [
  "POS_SALE_CASH",
  "POS_SALE_QRIS",
  "POS_SALE_DEBIT",
  "POS_SALE_CREDIT",
  "POS_SALE_ARK_COIN",
  "POS_SALE_GIFT_CARD",
  "POS_SALE_MEMBER_BILL",
  "POS_MEMBER_DEPOSIT_CASH",
  "POS_MEMBER_DEPOSIT_QRIS",
  "POS_MEMBER_DEPOSIT_CARD",
  "POS_COGS_RELIEF",
  "POS_REFUND",
  "PURCHASE_GRN",
  "PURCHASE_AP_INVOICE",
  "PURCHASE_PAYMENT",
  "PURCHASE_RETURN",
  "PURCHASE_LANDED_COST",
  "PURCHASE_LANDED_COST_REVERSAL",
  "PAYROLL_ACCRUAL",
  "PAYROLL_PAYMENT",
  "PAYROLL_PPH21_WITHHOLDING",
  "PAYROLL_LOAN_DEDUCTION",
  "PAYROLL_BPJS_TK_EMPLOYER",
  "PAYROLL_BPJS_KES_EMPLOYER",
  "PAYROLL_BPJS_TK_EMPLOYEE",
  "PAYROLL_BPJS_KES_EMPLOYEE",
  "PAYROLL_TAPERA_EMPLOYER",
  "PAYROLL_TAPERA_EMPLOYEE",
  "PINJAMAN_DISBURSEMENT",
  "PINJAMAN_REPAYMENT",
  "SALE_AR_INVOICE",
  "SALE_AR_RECEIPT",
  "STOCK_OPNAME_SHORTAGE",
  "STOCK_OPNAME_SURPLUS",
  "STOCK_ADJUSTMENT_SHORTAGE",
  "STOCK_ADJUSTMENT_SURPLUS",
  "STOCK_TRANSFER",
  "PRODUCTION_MATERIAL_ISSUE",
  "PRODUCTION_CONVERSION_COST",
  "PRODUCTION_OUTPUT_RECEIPT",
  "PRODUCTION_SCRAP",
  "PRODUCTION_ABNORMAL_SCRAP",
  "PRODUCTION_MATERIAL_RETURN",
  "GYM_SALE_CASH",
  "GYM_SALE_BANK",
  "GYM_SALE_QRIS",
  "GYM_SALE_ARK_COIN",
  "GYM_REFUND_CASH",
  "GYM_REFUND_BANK",
  "GYM_REFUND_QRIS",
  "GYM_REFUND_ARK_COIN",
  "GYM_CREDIT_USAGE",
  "GYM_CREDIT_USAGE_REVERSAL",
  "GYM_CREDIT_BREAKAGE",
  "GYM_PASS_REVENUE",
  "GYM_PASS_REVENUE_REVERSAL",
] as const;
export type JournalEventCode = (typeof JOURNAL_EVENT_CODES)[number];

export const JOURNAL_EVENT_META: Record<
  JournalEventCode,
  { name: string; module: JournalModule; description: string }
> = {
  POS_SALE_CASH: {
    name: "POS Sale — Cash",
    module: "POS",
    description: "Penjualan POS dibayar tunai",
  },
  POS_SALE_QRIS: {
    name: "POS Sale — QRIS",
    module: "POS",
    description: "Penjualan POS dibayar QRIS",
  },
  POS_SALE_DEBIT: {
    name: "POS Sale — Debit",
    module: "POS",
    description: "Penjualan POS kartu debit",
  },
  POS_SALE_CREDIT: {
    name: "POS Sale — Credit",
    module: "POS",
    description: "Penjualan POS kartu kredit",
  },
  POS_SALE_ARK_COIN: {
    name: "POS Sale — ARK Coin",
    module: "POS",
    description: "Penjualan POS pakai ARK Coin",
  },
  POS_SALE_GIFT_CARD: {
    name: "POS Sale — Gift Card",
    module: "POS",
    description: "Penjualan POS pakai gift card",
  },
  POS_SALE_MEMBER_BILL: {
    name: "POS Sale — Tagihan Member",
    module: "POS",
    description: "Order member ditutup dari saldo cicilan (Uang Muka Member ↔ Penjualan)",
  },
  POS_MEMBER_DEPOSIT_CASH: {
    name: "Tagihan Member — Cicilan Tunai",
    module: "POS",
    description: "Cicilan tagihan member diterima tunai (Kas ↔ Uang Muka Member)",
  },
  POS_MEMBER_DEPOSIT_QRIS: {
    name: "Tagihan Member — Cicilan QRIS",
    module: "POS",
    description: "Cicilan tagihan member via QRIS (Bank ↔ Uang Muka Member)",
  },
  POS_MEMBER_DEPOSIT_CARD: {
    name: "Tagihan Member — Cicilan Kartu/Transfer",
    module: "POS",
    description: "Cicilan tagihan member via kartu / non-tunai (Bank ↔ Uang Muka Member)",
  },
  POS_COGS_RELIEF: {
    name: "POS COGS Relief",
    module: "POS",
    description: "Pemakaian HPP / relief inventory saat penjualan",
  },
  POS_REFUND: {
    name: "POS Refund",
    module: "POS",
    description: "Pengembalian penjualan POS",
  },
  PURCHASE_GRN: {
    name: "Purchase GRN",
    module: "PURCHASING",
    description: "Penerimaan barang (GRN) ke inventory",
  },
  PURCHASE_AP_INVOICE: {
    name: "Purchase AP Invoice",
    module: "PURCHASING",
    description: "Invoice hutang vendor",
  },
  PURCHASE_PAYMENT: {
    name: "Purchase Payment",
    module: "PURCHASING",
    description: "Pembayaran hutang vendor",
  },
  PURCHASE_RETURN: {
    name: "Purchase Return",
    module: "PURCHASING",
    description: "Retur pembelian ke vendor",
  },
  PURCHASE_LANDED_COST: {
    name: "Purchase Landed Cost",
    module: "PURCHASING",
    description: "Biaya tambahan pembelian (ongkir, bea, handling) dikapitalisasi ke inventory",
  },
  PURCHASE_LANDED_COST_REVERSAL: {
    name: "Purchase Landed Cost Reversal",
    module: "PURCHASING",
    description: "Pembalikan biaya tambahan pembelian yang dihapus dari inventory",
  },
  PAYROLL_ACCRUAL: {
    name: "Payroll Accrual",
    module: "PAYROLL",
    description: "Pengakuan beban gaji (expense) dan hutang gaji",
  },
  PAYROLL_PAYMENT: {
    name: "Payroll Payment",
    module: "PAYROLL",
    description: "Pembayaran gaji bersih ke karyawan via bank/kas",
  },
  PAYROLL_PPH21_WITHHOLDING: {
    name: "Payroll PPh 21 Withholding",
    module: "PAYROLL",
    description: "Potongan PPh 21 dari payroll",
  },
  PAYROLL_LOAN_DEDUCTION: {
    name: "Payroll Loan Deduction",
    module: "PAYROLL",
    description: "Potongan cicilan pinjaman lewat payroll",
  },
  PAYROLL_BPJS_TK_EMPLOYER: {
    name: "Payroll BPJS Ketenagakerjaan (Pemberi Kerja)",
    module: "PAYROLL",
    description: "Iuran BPJS Ketenagakerjaan bagian perusahaan (beban dan hutang BPJS)",
  },
  PAYROLL_BPJS_KES_EMPLOYER: {
    name: "Payroll BPJS Kesehatan (Pemberi Kerja)",
    module: "PAYROLL",
    description: "Iuran BPJS Kesehatan bagian perusahaan (beban dan hutang BPJS)",
  },
  PAYROLL_BPJS_TK_EMPLOYEE: {
    name: "Payroll BPJS Ketenagakerjaan (Karyawan)",
    module: "PAYROLL",
    description: "Potongan BPJS Ketenagakerjaan karyawan (hutang gaji ke hutang BPJS)",
  },
  PAYROLL_BPJS_KES_EMPLOYEE: {
    name: "Payroll BPJS Kesehatan (Karyawan)",
    module: "PAYROLL",
    description: "Potongan BPJS Kesehatan karyawan (hutang gaji ke hutang BPJS)",
  },
  PAYROLL_TAPERA_EMPLOYER: {
    name: "Payroll Tapera (Pemberi Kerja)",
    module: "PAYROLL",
    description: "Iuran Tapera bagian perusahaan (beban dan hutang Tapera)",
  },
  PAYROLL_TAPERA_EMPLOYEE: {
    name: "Payroll Tapera (Karyawan)",
    module: "PAYROLL",
    description: "Potongan Tapera karyawan (hutang gaji ke hutang Tapera)",
  },
  PINJAMAN_DISBURSEMENT: {
    name: "Pinjaman — Pencairan",
    module: "PINJAMAN",
    description: "Pencairan pinjaman karyawan ke rekening/kas",
  },
  PINJAMAN_REPAYMENT: {
    name: "Pinjaman — Pelunasan/Cicilan",
    module: "PINJAMAN",
    description: "Cicilan atau pelunasan pinjaman di luar payroll",
  },
  SALE_AR_INVOICE: {
    name: "Sale AR Invoice",
    module: "SALES",
    description: "Pengakuan piutang dari invoice B2B / sales",
  },
  SALE_AR_RECEIPT: {
    name: "Sale AR Receipt",
    module: "SALES",
    description: "Penerimaan pembayaran piutang customer",
  },
  STOCK_OPNAME_SHORTAGE: {
    name: "Stock Opname — Shortage",
    module: "INVENTORY",
    description: "Selisih opname kurang (spoil/waste vs inventori)",
  },
  STOCK_OPNAME_SURPLUS: {
    name: "Stock Opname — Surplus",
    module: "INVENTORY",
    description: "Selisih opname lebih (inventori vs koreksi spoil)",
  },
  STOCK_ADJUSTMENT_SHORTAGE: {
    name: "Stock Adjustment — Shortage",
    module: "INVENTORY",
    description: "Penyesuaian stok kurang",
  },
  STOCK_ADJUSTMENT_SURPLUS: {
    name: "Stock Adjustment — Surplus",
    module: "INVENTORY",
    description: "Penyesuaian stok lebih",
  },
  STOCK_TRANSFER: {
    name: "Stock Transfer",
    module: "INVENTORY",
    description: "Transfer stok antar gudang (audit nilai inventori)",
  },
  PRODUCTION_MATERIAL_ISSUE: {
    name: "Production Material Issue",
    module: "INVENTORY",
    description: "Bahan baku dikeluarkan ke produksi: persediaan pindah ke barang dalam proses (WIP)",
  },
  PRODUCTION_CONVERSION_COST: {
    name: "Production Conversion Cost",
    module: "INVENTORY",
    description: "Biaya overhead, tenaga kerja, kemasan dan susut dibebankan ke WIP saat hasil produksi diterima",
  },
  PRODUCTION_OUTPUT_RECEIPT: {
    name: "Production Output Receipt",
    module: "INVENTORY",
    description: "Hasil produksi diterima ke persediaan dari WIP sebesar HPP batch",
  },
  PRODUCTION_SCRAP: {
    name: "Production Scrap",
    module: "INVENTORY",
    description: "Sisa WIP tanpa hasil baik dibebankan sebagai kerugian produksi",
  },
  PRODUCTION_ABNORMAL_SCRAP: {
    name: "Production Abnormal Scrap",
    module: "INVENTORY",
    description: "Scrap di atas toleransi dibebankan sebagai kerugian produksi dari WIP",
  },
  PRODUCTION_MATERIAL_RETURN: {
    name: "Production Material Return",
    module: "INVENTORY",
    description: "Bahan sisa produksi dikembalikan ke persediaan dari WIP",
  },
  GYM_SALE_CASH: {
    name: "Gym Package Sale (Cash)",
    module: "POS",
    description: "Paket gym dibayar tunai: kas ke pendapatan diterima di muka",
  },
  GYM_SALE_BANK: {
    name: "Gym Package Sale (Bank)",
    module: "POS",
    description: "Paket gym dibayar kartu atau transfer: bank ke pendapatan diterima di muka",
  },
  GYM_SALE_QRIS: {
    name: "Gym Package Sale (QRIS)",
    module: "POS",
    description: "Paket gym dibayar QRIS atau invoice online: kliring QRIS ke pendapatan diterima di muka",
  },
  GYM_SALE_ARK_COIN: {
    name: "Gym Package Sale (ARK Coin)",
    module: "POS",
    description: "Paket gym dibayar ARK Coin: kewajiban ARK Coin ke pendapatan diterima di muka",
  },
  GYM_REFUND_CASH: {
    name: "Gym Package Refund (Cash)",
    module: "POS",
    description: "Refund paket gym tunai: pendapatan diterima di muka ke kas",
  },
  GYM_REFUND_BANK: {
    name: "Gym Package Refund (Bank)",
    module: "POS",
    description: "Refund paket gym kartu atau transfer: pendapatan diterima di muka ke bank",
  },
  GYM_REFUND_QRIS: {
    name: "Gym Package Refund (QRIS)",
    module: "POS",
    description: "Refund paket gym QRIS atau invoice online: pendapatan diterima di muka ke kliring QRIS",
  },
  GYM_REFUND_ARK_COIN: {
    name: "Gym Package Refund (ARK Coin)",
    module: "POS",
    description: "Refund paket gym ke ARK Coin: pendapatan diterima di muka ke kewajiban ARK Coin",
  },
  GYM_CREDIT_USAGE: {
    name: "Gym Credit Usage",
    module: "POS",
    description: "Kredit gym terpakai (check-in, no-show, batal telat): pendapatan diterima di muka ke pendapatan kelas",
  },
  GYM_CREDIT_USAGE_REVERSAL: {
    name: "Gym Credit Usage Reversal",
    module: "POS",
    description: "Kredit gym dikembalikan ke member: pendapatan kelas ke pendapatan diterima di muka",
  },
  GYM_CREDIT_BREAKAGE: {
    name: "Gym Credit Breakage",
    module: "POS",
    description: "Kredit gym kedaluwarsa: pendapatan diterima di muka ke pendapatan kredit kedaluwarsa",
  },
  GYM_PASS_REVENUE: {
    name: "Gym Pass Revenue",
    module: "POS",
    description: "Pengakuan harian pendapatan pass gym dari pendapatan diterima di muka",
  },
  GYM_PASS_REVENUE_REVERSAL: {
    name: "Gym Pass Revenue Reversal",
    module: "POS",
    description: "Pass gym direfund: pendapatan pass yang sudah diakui kembali ke pendapatan diterima di muka",
  },
};

export function isCashBankLineRole(role: string): boolean {
  return role === "CASH" || role === "BANK";
}
