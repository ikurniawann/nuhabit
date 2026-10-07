/**
 * Payroll Configuration Loader
 *
 * Sumber kebenaran konfigurasi payroll adalah database
 * (hris.payroll_settings + hris.payroll_tax_config per tahun pajak).
 * Konstanta di file ini hanyalah fallback default saat baris konfigurasi
 * belum ada — bukan sumber kebenaran.
 */

import type { createServerPgClient } from "@/lib/pg/create-client";

type PgClient = Awaited<ReturnType<typeof createServerPgClient>>;

export interface PPh21Bracket {
  /** Lebar bracket dalam rupiah (bukan batas kumulatif) */
  width: number;
  rate: number;
}

export interface PayrollConfig {
  bpjsRates: {
    // Karyawan (fraksi, mis. 0.02 = 2%)
    bpjsTkJht: number;
    bpjsTkJp: number;
    bpjsKes: number;
    tapera: number;
    // Pemberi kerja
    bpjsTkJhtEmployer: number;
    bpjsTkJpEmployer: number;
    bpjsTkJkkEmployer: number;
    bpjsTkJkmEmployer: number;
    bpjsKesEmployer: number;
    taperaEmployer: number;
  };
  bpjsCaps: {
    bpjsTk: number;
    bpjsKes: number;
  };
  /** Bracket progresif PPh21, urut dari terendah; elemen terakhir width=Infinity */
  pph21Brackets: PPh21Bracket[];
  ptkp: {
    tk0: number;
    tk1: number;
    tk2: number;
    tk3: number;
    k0: number;
    k1: number;
    k2: number;
    k3: number;
  };
  jabatanExpense: {
    /** Fraksi dari bruto (mis. 0.05 = 5%) */
    percentage: number;
    /** Batas maksimum per tahun */
    maxPerYear: number;
  };
  overtimeMultiplier: number;
  /**
   * Multiplier lembur pada HARI LIBUR RESMI (EPIC-036 Fase F). PP 35/2021
   * menetapkan 2× upah sejam untuk jam-jam awal lembur di hari libur, versus
   * 1,5× di hari kerja.
   *
   * ⚠ Yang BELUM diterapkan: tangga progresif PP 35/2021 (jam ke-8 → 3×,
   * jam ke-9 dst → 4× di hari libur; jam ke-2 dst → 2× di hari kerja). Sistem
   * ini memakai satu tarif rata per bucket, sama seperti sebelumnya. Menerapkan
   * tangga penuh adalah keputusan kebijakan payroll tersendiri.
   */
  overtimeHolidayMultiplier: number;
  /** Upah per jam lembur = gaji pokok / pembagi (standar Kepmenaker 173). */
  overtimeHourlyDivisor: number;
  /** Kebijakan potongan keterlambatan (keputusan owner: konfigurabel). */
  lateDeduction: {
    mode: "off" | "per_minute" | "flat";
    /** per_minute → Rp/menit; flat → Rp/kejadian terlambat */
    amount: number;
  };
  thr: {
    eligibleMonths: number;
    prorate: boolean;
  };
  /** Limitasi pinjaman karyawan (Fase D). */
  loan: {
    /** Cicilan/bulan maksimal sebagai % gaji pokok */
    maxInstallmentPercent: number;
    /** Jumlah pinjaman aktif bersamaan per karyawan */
    maxActivePerEmployee: number;
  };
}

/** Fallback saat payroll_settings / payroll_tax_config kosong (tarif 2026). */
export const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
  bpjsRates: {
    bpjsTkJht: 0.02,
    bpjsTkJp: 0.01,
    bpjsKes: 0.01,
    tapera: 0.025,
    bpjsTkJhtEmployer: 0.037,
    bpjsTkJpEmployer: 0.02,
    bpjsTkJkkEmployer: 0.0024,
    bpjsTkJkmEmployer: 0.003,
    bpjsKesEmployer: 0.04,
    taperaEmployer: 0.005,
  },
  bpjsCaps: {
    bpjsTk: 10414000,
    bpjsKes: 12000000,
  },
  // Lebar bracket UU HPP: 0–60jt, 60–250jt, 250–500jt, 500jt–5M, >5M
  pph21Brackets: [
    { width: 60_000_000, rate: 0.05 },
    { width: 190_000_000, rate: 0.15 },
    { width: 250_000_000, rate: 0.25 },
    { width: 4_500_000_000, rate: 0.3 },
    { width: Infinity, rate: 0.35 },
  ],
  ptkp: {
    tk0: 54_000_000,
    tk1: 58_500_000,
    tk2: 63_000_000,
    tk3: 67_500_000,
    k0: 58_500_000,
    k1: 63_000_000,
    k2: 67_500_000,
    k3: 72_000_000,
  },
  jabatanExpense: {
    percentage: 0.05,
    maxPerYear: 6_000_000,
  },
  overtimeMultiplier: 1.5,
  overtimeHolidayMultiplier: 2,
  overtimeHourlyDivisor: 173,
  lateDeduction: {
    mode: "off",
    amount: 0,
  },
  thr: {
    eligibleMonths: 12,
    prorate: true,
  },
  loan: {
    maxInstallmentPercent: 30,
    maxActivePerEmployee: 1,
  },
};

const toFraction = (percent: unknown, fallback: number): number => {
  const n = Number(percent);
  return Number.isFinite(n) ? n / 100 : fallback;
};

const toNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Konversi batas kumulatif bracket (seperti disimpan di DB: 60jt, 250jt,
 * 500jt, 5M) menjadi lebar per bracket yang dipakai kalkulator.
 */
export function cumulativeLimitsToBrackets(
  limits: number[],
  rates: number[]
): PPh21Bracket[] {
  const brackets: PPh21Bracket[] = [];
  let previous = 0;
  for (let i = 0; i < rates.length; i++) {
    const isLast = i >= limits.length;
    const width = isLast ? Infinity : Math.max(0, limits[i] - previous);
    brackets.push({ width, rate: rates[i] });
    if (!isLast) previous = limits[i];
  }
  return brackets;
}

/**
 * Muat konfigurasi payroll dari DB dengan fallback default per nilai.
 * `taxYear` memilih baris payroll_tax_config; jika tidak ada baris aktif
 * untuk tahun itu, PTKP/bracket memakai payroll_settings, lalu default.
 */
export async function loadPayrollConfig(
  db: PgClient,
  taxYear: number
): Promise<PayrollConfig> {
  const d = DEFAULT_PAYROLL_CONFIG;

  const [{ data: settings }, { data: taxConfig }] = await Promise.all([
    db
      .from("payroll_settings")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from("payroll_tax_config")
      .select("*")
      .eq("tax_year", taxYear)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  // Sumber PTKP & bracket: tax_config (per tahun) > settings > default
  const taxSource = taxConfig ?? settings;

  const ptkp = {
    tk0: toNumber(taxSource?.ptkp_tk_0, d.ptkp.tk0),
    tk1: toNumber(taxSource?.ptkp_tk_1, d.ptkp.tk1),
    tk2: toNumber(taxSource?.ptkp_tk_2, d.ptkp.tk2),
    tk3: toNumber(taxSource?.ptkp_tk_3, d.ptkp.tk3),
    k0: toNumber(taxSource?.ptkp_k_0, d.ptkp.k0),
    k1: toNumber(taxSource?.ptkp_k_1, d.ptkp.k1),
    k2: toNumber(taxSource?.ptkp_k_2, d.ptkp.k2),
    k3: toNumber(taxSource?.ptkp_k_3, d.ptkp.k3),
  };

  let pph21Brackets = d.pph21Brackets;
  if (taxConfig) {
    pph21Brackets = cumulativeLimitsToBrackets(
      [
        toNumber(taxConfig.bracket_1_limit, 60_000_000),
        toNumber(taxConfig.bracket_2_limit, 250_000_000),
        toNumber(taxConfig.bracket_3_limit, 500_000_000),
        toNumber(taxConfig.bracket_4_limit, 5_000_000_000),
      ],
      [
        toFraction(taxConfig.bracket_1_rate, 0.05),
        toFraction(taxConfig.bracket_2_rate, 0.15),
        toFraction(taxConfig.bracket_3_rate, 0.25),
        toFraction(taxConfig.bracket_4_rate, 0.3),
        toFraction(taxConfig.bracket_5_rate, 0.35),
      ]
    );
  } else if (settings) {
    pph21Brackets = cumulativeLimitsToBrackets(
      [
        toNumber(settings.pph21_bracket_1, 60_000_000),
        toNumber(settings.pph21_bracket_2, 250_000_000),
        toNumber(settings.pph21_bracket_3, 500_000_000),
        toNumber(settings.pph21_bracket_4, 5_000_000_000),
      ],
      d.pph21Brackets.map((b) => b.rate)
    );
  }

  return {
    bpjsRates: {
      bpjsTkJht: toFraction(settings?.bpjs_tk_jht_employee, d.bpjsRates.bpjsTkJht),
      bpjsTkJp: toFraction(settings?.bpjs_tk_jp_employee, d.bpjsRates.bpjsTkJp),
      bpjsKes: toFraction(settings?.bpjs_kes_employee, d.bpjsRates.bpjsKes),
      tapera: toFraction(settings?.tapera_employee, d.bpjsRates.tapera),
      bpjsTkJhtEmployer: toFraction(settings?.bpjs_tk_jht_employer, d.bpjsRates.bpjsTkJhtEmployer),
      bpjsTkJpEmployer: toFraction(settings?.bpjs_tk_jp_employer, d.bpjsRates.bpjsTkJpEmployer),
      bpjsTkJkkEmployer: toFraction(settings?.bpjs_tk_jkk, d.bpjsRates.bpjsTkJkkEmployer),
      bpjsTkJkmEmployer: toFraction(settings?.bpjs_tk_jkm, d.bpjsRates.bpjsTkJkmEmployer),
      bpjsKesEmployer: toFraction(settings?.bpjs_kes_employer, d.bpjsRates.bpjsKesEmployer),
      taperaEmployer: toFraction(settings?.tapera_employer, d.bpjsRates.taperaEmployer),
    },
    bpjsCaps: {
      bpjsTk: d.bpjsCaps.bpjsTk,
      bpjsKes: toNumber(settings?.bpjs_kes_max_upah, d.bpjsCaps.bpjsKes),
    },
    pph21Brackets,
    ptkp,
    jabatanExpense: {
      percentage: toFraction(taxConfig?.jabatan_expense_percentage, d.jabatanExpense.percentage),
      maxPerYear: toNumber(taxConfig?.jabatan_expense_max, d.jabatanExpense.maxPerYear),
    },
    overtimeMultiplier: toNumber(settings?.overtime_multiplier, d.overtimeMultiplier),
    overtimeHolidayMultiplier: toNumber(
      settings?.overtime_multiplier_holiday,
      d.overtimeHolidayMultiplier
    ),
    overtimeHourlyDivisor: toNumber(
      settings?.overtime_hourly_divisor,
      d.overtimeHourlyDivisor
    ),
    lateDeduction: {
      mode: (["off", "per_minute", "flat"] as const).includes(
        settings?.late_deduction_mode
      )
        ? settings.late_deduction_mode
        : d.lateDeduction.mode,
      amount: toNumber(settings?.late_deduction_amount, d.lateDeduction.amount),
    },
    thr: {
      eligibleMonths: toNumber(settings?.thr_eligible_months, d.thr.eligibleMonths),
      prorate: settings?.thr_prorate ?? d.thr.prorate,
    },
    loan: {
      maxInstallmentPercent: toNumber(
        settings?.loan_max_installment_percent,
        d.loan.maxInstallmentPercent
      ),
      maxActivePerEmployee: toNumber(
        settings?.loan_max_active_per_employee,
        d.loan.maxActivePerEmployee
      ),
    },
  };
}
