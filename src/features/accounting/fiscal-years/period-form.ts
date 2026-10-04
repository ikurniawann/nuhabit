import type { generateMonthlyPeriods } from "@/lib/accounting/fiscal-periods";
import type { FiscalPeriodStatus } from "@/lib/accounting/fiscal-types";

/** Aturan murni editor period fiscal year (diuji unit). */

export type FormPeriod = {
  key: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: FiscalPeriodStatus;
};

type GeneratedPeriods = ReturnType<typeof generateMonthlyPeriods>;

export function toFormPeriods(periods: GeneratedPeriods): FormPeriod[] {
  return periods.map((p) => ({ key: `p-${p.period_no}`, ...p }));
}

/**
 * Period hasil generate ulang: key & nama lama dipertahankan, status ikut hasil
 * generate (period 1 OPEN, sisanya CLOSED) agar urutan tetap valid.
 */
export function mergeRegeneratedPeriods(previous: FormPeriod[], generated: GeneratedPeriods): FormPeriod[] {
  return generated.map((p) => {
    const prev = previous.find((x) => x.period_no === p.period_no);
    return { key: prev?.key ?? `p-${p.period_no}`, ...p, name: prev?.name || p.name };
  });
}

export function togglePeriod(periods: FormPeriod[], key: string): FormPeriod[] {
  return periods.map((p) => (p.key === key ? { ...p, status: p.status === "OPEN" ? "CLOSED" : "OPEN" } : p));
}

/**
 * Buka period setelah period OPEN terakhir (atau CLOSED pertama) dan tutup
 * period OPEN sebelumnya. Null bila tidak ada period berikutnya.
 */
export function planOpenNextPeriod(periods: FormPeriod[]) {
  const sorted = [...periods].sort((a, b) => a.period_no - b.period_no);
  const openPeriods = sorted.filter((p) => p.status === "OPEN");
  const lastOpen = openPeriods[openPeriods.length - 1];
  const next = lastOpen
    ? sorted.find((p) => p.period_no === lastOpen.period_no + 1)
    : sorted.find((p) => p.status === "CLOSED");
  if (!next) return null;

  const closed = openPeriods.filter((p) => p.period_no < next.period_no);
  return {
    next,
    closedNames: closed.map((p) => p.name).join(", "),
    periods: periods.map((p) => {
      if (p.period_no < next.period_no && p.status === "OPEN") return { ...p, status: "CLOSED" as const };
      if (p.key === next.key) return { ...p, status: "OPEN" as const };
      return p;
    }),
  };
}
