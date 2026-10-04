/** Agregasi jam sibuk POS — jam & hari pakai kalender operasional WIB. */

export const RUSH_HOUR_HEATMAP_HOURS = [
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
] as const;

export const RUSH_HOUR_WEEKDAYS = [
  { dow: 1, label: "Sen" },
  { dow: 2, label: "Sel" },
  { dow: 3, label: "Rab" },
  { dow: 4, label: "Kam" },
  { dow: 5, label: "Jum" },
  { dow: 6, label: "Sab" },
  { dow: 7, label: "Min" },
] as const;

export type RushHourPoint = {
  hour: number;
  dow: number;
  transactions: number;
  revenue: number;
  /** Jumlah item terjual (Σ quantity pos_order_items) — opsional utk kompat. */
  quantity?: number;
};

export type RushHourBucket = {
  hour: number;
  label: string;
  transactions: number;
  revenue: number;
  quantity: number;
  average_ticket: number;
};

export type RushHourWeekday = {
  dow: number;
  label: string;
  transactions: number;
  revenue: number;
};

export type RushHourPeak = {
  hour: number | null;
  hour_label: string | null;
  dow: number | null;
  dow_label: string | null;
  transactions: number;
  revenue: number;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatHourLabel(hour: number) {
  const safe = Math.min(23, Math.max(0, Math.floor(hour)));
  return `${String(safe).padStart(2, "0")}:00`;
}

export function weekdayLabel(dow: number) {
  return RUSH_HOUR_WEEKDAYS.find((day) => day.dow === dow)?.label ?? `Hari ${dow}`;
}

function averageTicket(revenue: number, transactions: number) {
  if (transactions <= 0) return 0;
  return round2(revenue / transactions);
}

export function buildRushHourReport(points: RushHourPoint[]) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: formatHourLabel(hour),
    transactions: 0,
    revenue: 0,
    quantity: 0,
    average_ticket: 0,
  }));
  const weekdays: RushHourWeekday[] = RUSH_HOUR_WEEKDAYS.map((day) => ({
    dow: day.dow,
    label: day.label,
    transactions: 0,
    revenue: 0,
  }));
  const heatmap = new Map<string, RushHourPoint>();

  let totalTransactions = 0;
  let totalRevenue = 0;
  let totalQuantity = 0;

  for (const point of points) {
    const hour = Math.floor(Number(point.hour));
    const dow = Math.floor(Number(point.dow));
    if (hour < 0 || hour > 23 || dow < 1 || dow > 7) continue;
    const transactions = Math.max(0, Number(point.transactions) || 0);
    const revenue = Math.max(0, Number(point.revenue) || 0);
    const quantity = Math.max(0, Number(point.quantity) || 0);
    hourly[hour].transactions += transactions;
    hourly[hour].revenue += revenue;
    hourly[hour].quantity += quantity;
    const day = weekdays[dow - 1];
    if (day) {
      day.transactions += transactions;
      day.revenue += revenue;
    }
    const key = `${dow}-${hour}`;
    const existing = heatmap.get(key);
    if (existing) {
      existing.transactions += transactions;
      existing.revenue += revenue;
    } else {
      heatmap.set(key, { hour, dow, transactions, revenue });
    }
    totalTransactions += transactions;
    totalRevenue += revenue;
    totalQuantity += quantity;
  }

  for (const bucket of hourly) {
    bucket.revenue = round2(bucket.revenue);
    bucket.average_ticket = averageTicket(bucket.revenue, bucket.transactions);
  }

  const peakByCount = hourly.reduce<RushHourBucket | null>((best, bucket) => {
    if (bucket.transactions <= 0) return best;
    if (!best || bucket.transactions > best.transactions) return bucket;
    return best;
  }, null);
  const peakByRevenue = hourly.reduce<RushHourBucket | null>((best, bucket) => {
    if (bucket.revenue <= 0) return best;
    if (!best || bucket.revenue > best.revenue) return bucket;
    return best;
  }, null);
  const peakDay = weekdays.reduce<RushHourWeekday | null>((best, day) => {
    if (day.transactions <= 0) return best;
    if (!best || day.transactions > best.transactions) return day;
    return best;
  }, null);

  const heatmapCells = RUSH_HOUR_WEEKDAYS.flatMap((day) =>
    RUSH_HOUR_HEATMAP_HOURS.map((hour) => {
      const cell = heatmap.get(`${day.dow}-${hour}`);
      return {
        hour,
        dow: day.dow,
        transactions: cell?.transactions ?? 0,
        revenue: round2(cell?.revenue ?? 0),
      };
    })
  );

  return {
    summary: {
      transactions: totalTransactions,
      revenue: round2(totalRevenue),
      quantity: totalQuantity,
      average_ticket: averageTicket(totalRevenue, totalTransactions),
    },
    peak_hour: {
      hour: peakByCount?.hour ?? null,
      hour_label: peakByCount ? peakByCount.label : null,
      dow: null,
      dow_label: null,
      transactions: peakByCount?.transactions ?? 0,
      revenue: peakByCount?.revenue ?? 0,
    } satisfies RushHourPeak,
    peak_revenue_hour: {
      hour: peakByRevenue?.hour ?? null,
      hour_label: peakByRevenue ? peakByRevenue.label : null,
      dow: null,
      dow_label: null,
      transactions: peakByRevenue?.transactions ?? 0,
      revenue: peakByRevenue?.revenue ?? 0,
    } satisfies RushHourPeak,
    peak_day: {
      hour: null,
      hour_label: null,
      dow: peakDay?.dow ?? null,
      dow_label: peakDay?.label ?? null,
      transactions: peakDay?.transactions ?? 0,
      revenue: peakDay ? round2(peakDay.revenue) : 0,
    } satisfies RushHourPeak,
    hourly,
    weekdays: weekdays.map((day) => ({ ...day, revenue: round2(day.revenue) })),
    heatmap: heatmapCells,
  };
}

export function rushHourHeatIntensity(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  return value / max;
}

export type HourRangeContribution = {
  from_hour: number;
  to_hour: number;
  label: string;
  transactions: number;
  revenue: number;
  quantity: number;
  /** Kontribusi terhadap total keseluruhan, dalam persen 0–100 (1 desimal). */
  share_revenue: number;
  share_quantity: number;
  share_transactions: number;
  hours: RushHourBucket[];
};

function sharePct(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Kontribusi sales sebuah RENTANG JAM (permintaan owner 2026-09-01):
 * mis. 07:00–12:00 menyumbang berapa % dari total — dihitung ganda
 * berdasarkan Amount (omzet) dan Quantity (jumlah item terjual).
 * Jam akhir bersifat inklusif (07–12 = bucket 07:00 s.d. 12:59).
 */
export function buildHourRangeContribution(
  hourly: RushHourBucket[],
  summary: { transactions: number; revenue: number; quantity: number },
  fromHour: number,
  toHour: number
): HourRangeContribution {
  const from = Math.min(23, Math.max(0, Math.floor(fromHour)));
  const to = Math.min(23, Math.max(from, Math.floor(toHour)));
  const hours = hourly.filter((b) => b.hour >= from && b.hour <= to);
  const transactions = hours.reduce((sum, b) => sum + b.transactions, 0);
  const revenue = Math.round(hours.reduce((sum, b) => sum + b.revenue, 0) * 100) / 100;
  const quantity = hours.reduce((sum, b) => sum + b.quantity, 0);
  return {
    from_hour: from,
    to_hour: to,
    label: `${formatHourLabel(from)}–${formatHourLabel(to)}:59`,
    transactions,
    revenue,
    quantity,
    share_revenue: sharePct(revenue, summary.revenue),
    share_quantity: sharePct(quantity, summary.quantity),
    share_transactions: sharePct(transactions, summary.transactions),
    hours,
  };
}
