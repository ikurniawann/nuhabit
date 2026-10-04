import { query } from "@/lib/db";
import { brandName } from "@/lib/branding";

/**
 * Daily Flash Report (permintaan owner 2026-08-23) — meniru laporan manual
 * tim Operations, dikirim otomatis lewat digest WA pagi hari dengan data
 * HARI INI — digest terkirim di `digestHour` (default 22:00 WIB, jam tutup),
 * sehingga tanggal laporan = tanggal terima (koreksi owner 2026-08-30).
 *
 * Definisi angka (dari contoh manual Operations):
 * - Revenue      = Σ subtotal (harga sebelum diskon) order LUNAS non-void
 * - Discount     = Σ discount_amount
 * - Nett Sales   = Σ total_amount (Revenue − Discount)
 * - SULU Citizen = jumlah transaksi member ber-KARTU (member_type = 'card')
 * - Disc 100%    = transaksi yang diskonnya menutup seluruh subtotal
 * - No of Guest  = Σ guest_count (order tanpa guest_count dihitung 1 tamu)
 * - Average/Pax  = Nett Sales / No of Guest
 * - Sales by Stall = per stall (warehouse) — stall tanpa penjualan tetap
 *   ditampilkan Rp 0, seperti laporan manual.
 */

export interface FlashReportData {
  operationHour: string | null;
  revenue: number;
  nettSales: number;
  discount: number;
  citizenCardTx: number;
  fullDiscountTx: number;
  /** EPIC-043 — nilai GROSS (subtotal) & jumlah transaksi komplimen. */
  kolCompIdr: number;
  kolCompTx: number;
  ownerCompIdr: number;
  ownerCompTx: number;
  focCompIdr: number;
  focCompTx: number;
  guestCount: number;
  byStall: Array<{ name: string; revenue: number; pcs: number }>;
  byCategory: Array<{ name: string; revenue: number; pcs: number }>;
  topProducts: Array<{ name: string; pcs: number }>;
}

const PAID_FILTER = `
  o.payment_status = 'paid'
  AND o.status NOT IN ('cancelled', 'voided', 'merged')
  AND o.ordered_at >= $1 AND o.ordered_at < $2`;

/** Batas hari WIB [00:00, 24:00) utk tanggal `dateWib` (YYYY-MM-DD). */
export function wibDayRange(dateWib: string): { start: string; end: string } {
  const start = new Date(`${dateWib}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function gatherFlashReportData(dateWib: string): Promise<FlashReportData> {
  const { start, end } = wibDayRange(dateWib);

  const [summaryRows, hourRows, stallRows, allStallRows, categoryRows, topRows] =
    await Promise.all([
      query<{
        revenue: string;
        discount: string;
        nett: string;
        citizen_card_tx: string;
        full_discount_tx: string;
        kol_comp_idr: string;
        kol_comp_tx: string;
        owner_comp_idr: string;
        owner_comp_tx: string;
        foc_comp_idr: string;
        foc_comp_tx: string;
        guest_count: string;
      }>(
        `SELECT COALESCE(SUM(o.subtotal), 0) AS revenue,
                COALESCE(SUM(o.discount_amount), 0) AS discount,
                COALESCE(SUM(o.total_amount), 0) AS nett,
                COUNT(*) FILTER (WHERE c.member_type = 'card') AS citizen_card_tx,
                COUNT(*) FILTER (
                  WHERE o.subtotal > 0 AND o.discount_amount >= o.subtotal
                ) AS full_discount_tx,
                COALESCE(SUM(o.subtotal) FILTER (WHERE o.comp_type = 'kol_comp'), 0) AS kol_comp_idr,
                COUNT(*) FILTER (WHERE o.comp_type = 'kol_comp') AS kol_comp_tx,
                COALESCE(SUM(o.subtotal) FILTER (WHERE o.comp_type = 'owner_comp'), 0) AS owner_comp_idr,
                COUNT(*) FILTER (WHERE o.comp_type = 'owner_comp') AS owner_comp_tx,
                COALESCE(SUM(o.subtotal) FILTER (WHERE o.comp_type = 'foc_comp'), 0) AS foc_comp_idr,
                COUNT(*) FILTER (WHERE o.comp_type = 'foc_comp') AS foc_comp_tx,
                COALESCE(SUM(COALESCE(NULLIF(o.guest_count, 0), 1)), 0) AS guest_count
         FROM pos.pos_orders o
         LEFT JOIN pos.pos_customers c ON c.id = o.customer_id
         WHERE ${PAID_FILTER}`,
        [start, end]
      ),
      query<{ first_at: string | null; last_at: string | null }>(
        `SELECT MIN(o.ordered_at) AS first_at, MAX(o.ordered_at) AS last_at
         FROM pos.pos_orders o WHERE ${PAID_FILTER}`,
        [start, end]
      ),
      query<{ name: string | null; revenue: string; pcs: string }>(
        `SELECT w.name, COALESCE(SUM(oi.total_amount), 0) AS revenue,
                COALESCE(SUM(oi.quantity), 0) AS pcs
         FROM pos.pos_order_items oi
         JOIN pos.pos_orders o ON o.id = oi.order_id
         LEFT JOIN configuration.warehouses w ON w.id = o.warehouse_id
         WHERE ${PAID_FILTER}
         GROUP BY w.name`,
        [start, end]
      ),
      // Semua stall yang punya produk POS — stall sepi tetap tampil Rp 0.
      query<{ name: string }>(
        `SELECT DISTINCT w.name
         FROM pos.pos_products pp
         JOIN item.products ip ON ip.id = pp.source_product_id
         JOIN configuration.warehouses w ON w.id = ip.warehouse_id
         WHERE pp.is_active`
      ),
      query<{ name: string | null; revenue: string; pcs: string }>(
        `SELECT cat.name, COALESCE(SUM(oi.total_amount), 0) AS revenue,
                COALESCE(SUM(oi.quantity), 0) AS pcs
         FROM pos.pos_order_items oi
         JOIN pos.pos_orders o ON o.id = oi.order_id
         LEFT JOIN pos.pos_products p ON p.id = oi.product_id
         LEFT JOIN pos.pos_categories cat ON cat.id = p.category_id
         WHERE ${PAID_FILTER}
         GROUP BY cat.name
         ORDER BY 2 DESC`,
        [start, end]
      ),
      query<{ name: string; pcs: string }>(
        `SELECT oi.product_name AS name, COALESCE(SUM(oi.quantity), 0) AS pcs
         FROM pos.pos_order_items oi
         JOIN pos.pos_orders o ON o.id = oi.order_id
         WHERE ${PAID_FILTER}
         GROUP BY oi.product_name
         ORDER BY 2 DESC
         LIMIT 5`,
        [start, end]
      ),
    ]);

  const s = summaryRows[0];
  const jam = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Jakarta",
        })
      : null;
  const firstAt = jam(hourRows[0]?.first_at ?? null);
  const lastAt = jam(hourRows[0]?.last_at ?? null);

  const soldByStall = new Map(
    stallRows.map((row) => [row.name || "Tanpa stall", row])
  );
  const stallNames = new Set<string>([
    ...allStallRows.map((row) => row.name),
    ...soldByStall.keys(),
  ]);
  const byStall = [...stallNames]
    .map((name) => {
      const sold = soldByStall.get(name);
      return {
        name,
        revenue: Number(sold?.revenue) || 0,
        pcs: Number(sold?.pcs) || 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return {
    operationHour: firstAt && lastAt ? `${firstAt}–${lastAt} WIB` : null,
    revenue: Number(s?.revenue) || 0,
    nettSales: Number(s?.nett) || 0,
    discount: Number(s?.discount) || 0,
    citizenCardTx: Number(s?.citizen_card_tx) || 0,
    fullDiscountTx: Number(s?.full_discount_tx) || 0,
    kolCompIdr: Number(s?.kol_comp_idr) || 0,
    kolCompTx: Number(s?.kol_comp_tx) || 0,
    ownerCompIdr: Number(s?.owner_comp_idr) || 0,
    ownerCompTx: Number(s?.owner_comp_tx) || 0,
    focCompIdr: Number(s?.foc_comp_idr) || 0,
    focCompTx: Number(s?.foc_comp_tx) || 0,
    guestCount: Number(s?.guest_count) || 0,
    byStall,
    byCategory: categoryRows.map((row) => ({
      name: row.name || "Tanpa kategori",
      revenue: Number(row.revenue) || 0,
      pcs: Number(row.pcs) || 0,
    })),
    topProducts: topRows.map((row) => ({ name: row.name, pcs: Number(row.pcs) || 0 })),
  };
}

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function buildFlashReportMessage(data: FlashReportData, dateWib: string): string {
  // timeZone wajib: container berjalan di UTC — tanpa ini 00:00 WIB terbaca
  // sebagai tanggal kemarin (judul mundur sehari, bug owner 2026-10-01).
  const tanggal = new Date(`${dateWib}T00:00:00+07:00`).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const avgPerPax = data.guestCount > 0 ? data.nettSales / data.guestCount : 0;

  const lines: string[] = [
    `📊 *Daily Flash Report*`,
    brandName().toUpperCase(),
    tanggal,
  ];
  if (data.operationHour) lines.push(`Jam operasional: ${data.operationHour}`);
  lines.push(
    `--------------------------------`,
    `*SALES SUMMARY*`,
    `Revenue : ${rp(data.revenue)}`,
    `Nett Sales : ${rp(data.nettSales)}`,
    `Discount : ${rp(data.discount)}`,
    `SULU Citizen : ${data.citizenCardTx} Card`,
    `Disc 100% : ${data.fullDiscountTx} Transaksi`,
    ...(data.kolCompTx > 0
      ? [`KOL Comp : ${rp(data.kolCompIdr)} (${data.kolCompTx} Trx)`]
      : []),
    ...(data.focCompTx > 0
      ? [`Komplimen FOC : ${rp(data.focCompIdr)} (${data.focCompTx} Trx)`]
      : []),
    ...(data.ownerCompTx > 0
      ? [`Owner Comp : ${rp(data.ownerCompIdr)} (${data.ownerCompTx} Trx)`]
      : []),
    ``,
    `No of Guest : ${data.guestCount} Pax`,
    `Average/Pax : ${rp(avgPerPax)}`,
    ``,
    `*SALES BY STALL*`
  );
  for (const stall of data.byStall) {
    lines.push(
      stall.pcs > 0
        ? `${stall.name} : ${rp(stall.revenue)} (${stall.pcs} Pcs)`
        : `${stall.name} : Rp 0`
    );
  }
  lines.push(``, `*SALES BY CATEGORY*`);
  for (const cat of data.byCategory) {
    lines.push(`${cat.name} : ${rp(cat.revenue)} (${cat.pcs} Pcs)`);
  }
  lines.push(``, `*TOP PRODUCT*`);
  data.topProducts.forEach((product, i) => {
    lines.push(`${i + 1}. ${product.name} : ${product.pcs} pcs`);
  });
  if (data.topProducts.length === 0) lines.push(`—`);

  return lines.join("\n");
}
