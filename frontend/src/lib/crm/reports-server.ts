import "server-only";
/**
 * Laporan CRM tetap: loyalti & rekonsiliasi venue (EPIC-011 Fase E) dan
 * customer service (EPIC-012 Fase E). Respons CS sengaja TIDAK memuat isi
 * chat maupun nomor customer — hanya angka agregat.
 */
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import {
  mapFrequentVisitorRow,
  mapTopSpenderRow,
  mapVenueReconciliationRow,
  resolveReportPeriod,
  sumReconciliation,
  type ReportPeriod,
} from "./reports";
import { toNumber } from "./server";

/** Periode dari ?from=&to=; 400 bila tidak valid. */
export function requireReportPeriod(searchParams: URLSearchParams): ReportPeriod {
  const period = resolveReportPeriod(searchParams.get("from"), searchParams.get("to"));
  if (!period) {
    throw ApiError.badRequest("Periode tidak valid (format YYYY-MM-DD, from <= to, maksimal 366 hari)");
  }
  return period;
}

const LEADERBOARD_LIMIT = 20;

// Order dianggap belanja bila sudah dibayar dan tidak dibatalkan/void —
// keputusan owner #11: top spender = nilai belanja/order (semua metode),
// topup TIDAK dihitung.
const PAID_ORDER_FILTER = `
  o.payment_status = 'paid'
  AND (o.status IS NULL OR o.status NOT IN ('cancelled', 'voided'))
  AND o.customer_id IS NOT NULL
  AND o.created_at >= $1 AND o.created_at < $2
`;

/** Top spender, pengunjung tersering, rekonsiliasi saldo ARK per venue. */
export async function loadLoyaltyReport(period: ReportPeriod) {
  const periodParams = [period.fromIso, period.toIso];

  const [topSpenderRows, frequentVisitorRows, reconciliationRows, untaggedRow, summaryRow] = await Promise.all([
    query(
      `SELECT c.id, c.name, c.phone, c.membership_tier, c.member_type,
              COUNT(o.id) AS order_count,
              COALESCE(SUM(o.total_amount), 0) AS total_spend,
              COALESCE(SUM(o.ark_coins_used), 0) AS ark_spend,
              MAX(o.created_at) AS last_order_at
       FROM pos.pos_orders o
       JOIN pos.pos_customers c ON c.id = o.customer_id
       WHERE ${PAID_ORDER_FILTER}
       GROUP BY c.id
       ORDER BY total_spend DESC
       LIMIT ${LEADERBOARD_LIMIT}`,
      periodParams
    ),
    query(
      `SELECT c.id, c.name, c.phone, c.membership_tier, c.member_type,
              COUNT(o.id) AS order_count,
              COUNT(DISTINCT (o.created_at AT TIME ZONE 'Asia/Jakarta')::date) AS visit_days,
              MAX(o.created_at) AS last_visit_at,
              c.visit_count AS lifetime_visits
       FROM pos.pos_orders o
       JOIN pos.pos_customers c ON c.id = o.customer_id
       WHERE ${PAID_ORDER_FILTER}
       GROUP BY c.id
       ORDER BY visit_days DESC, order_count DESC
       LIMIT ${LEADERBOARD_LIMIT}`,
      periodParams
    ),
    query(
      `SELECT w.company_id, w.branch_id,
              co.name AS company_name,
              br.name AS branch_name,
              -- Topup berbayar (kas masuk) dipisah dari FOC (gratis/marketing).
              COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'topup' AND COALESCE(w.payment_method, '') <> 'foc'), 0) AS topup_amount,
              COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'topup' AND w.payment_method = 'foc'), 0) AS foc_topup_amount,
              COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'topup_bonus'), 0) AS bonus_amount,
              COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'payment'), 0) AS spend_amount,
              COALESCE(SUM(w.amount) FILTER (WHERE w.type NOT IN ('topup', 'topup_bonus', 'payment')), 0) AS other_amount,
              COUNT(*) FILTER (WHERE w.type = 'topup' AND COALESCE(w.payment_method, '') <> 'foc') AS topup_count,
              COUNT(*) FILTER (WHERE w.type = 'topup' AND w.payment_method = 'foc') AS foc_topup_count,
              COUNT(*) FILTER (WHERE w.type = 'payment') AS payment_count
       FROM pos.pos_wallet_transactions w
       LEFT JOIN configuration.companies co ON co.id = w.company_id
       LEFT JOIN configuration.branches br ON br.id = w.branch_id
       WHERE w.created_at >= $1 AND w.created_at < $2
         -- Transaksi tanpa venue (company_id kosong) tidak bisa
         -- direkonsiliasi antar-venue, jadi tidak ditampilkan
         -- (permintaan owner 2026-09-01). Nilainya tetap dilaporkan
         -- terpisah lewat untagged_* di bawah supaya tidak hilang senyap.
         AND w.company_id IS NOT NULL
       GROUP BY w.company_id, w.branch_id, co.name, br.name
       ORDER BY topup_amount DESC, spend_amount DESC`,
      periodParams
    ),
    queryOne(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'topup' AND COALESCE(payment_method, '') <> 'foc'), 0) AS topup_amount,
         COUNT(*) FILTER (WHERE type = 'topup' AND COALESCE(payment_method, '') <> 'foc') AS topup_count
       FROM pos.pos_wallet_transactions
       WHERE created_at >= $1 AND created_at < $2 AND company_id IS NULL`,
      periodParams
    ),
    queryOne(
      `SELECT
         (SELECT COALESCE(SUM(ark_coin_balance), 0) FROM pos.pos_customers WHERE is_active) AS outstanding_balance,
         (SELECT COUNT(*) FROM pos.pos_customers WHERE is_active AND member_type = 'card') AS card_members,
         (SELECT COUNT(*) FROM pos.pos_customers WHERE is_active AND member_type = 'registered') AS registered_members`
    ),
  ]);

  const reconciliation = reconciliationRows.map(mapVenueReconciliationRow);

  return {
    period: { from: period.fromDate, to: period.toDate },
    topSpenders: topSpenderRows.map(mapTopSpenderRow),
    frequentVisitors: frequentVisitorRows.map(mapFrequentVisitorRow),
    reconciliation: {
      venues: reconciliation,
      totals: sumReconciliation(reconciliation),
      // Saldo ARK beredar = liabilitas platform saat ini (bukan per periode).
      outstanding_balance: toNumber(summaryRow?.outstanding_balance),
      // Topup yang belum bertanda venue: tidak masuk tabel per-venue,
      // tapi tetap dilaporkan agar kasnya tidak hilang dari pandangan.
      untagged_topup_amount: toNumber(untaggedRow?.topup_amount),
      untagged_topup_count: toNumber(untaggedRow?.topup_count),
    },
    members: {
      card: toNumber(summaryRow?.card_members),
      registered: toNumber(summaryRow?.registered_members),
    },
  };
}

/** Laporan CS: ringkasan SLA, harian, kategori komplain, CSAT, agent, kanal, ulasan Google. */
export async function loadCsReport(period: ReportPeriod) {
  const periodParams = [period.fromIso, period.toIso];

  const [summaryRow, dailyRows, categoryRows, csatRows, agentRows, channelRows, reviewRow] =
    await Promise.all([
    queryOne(
      `SELECT
         COUNT(*)::int AS total_conversations,
         COUNT(*) FILTER (WHERE is_complaint)::int AS total_complaints,
         COUNT(*) FILTER (WHERE status = 'resolved')::int AS total_resolved,
         COUNT(*) FILTER (WHERE sla_response_breached)::int AS total_sla_breached,
         AVG(first_response_seconds) FILTER (WHERE first_response_seconds IS NOT NULL)
           AS avg_first_response_seconds,
         AVG(resolution_seconds) FILTER (WHERE resolution_seconds IS NOT NULL)
           AS avg_resolution_seconds,
         AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL) AS avg_csat,
         COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::int AS csat_responses
       FROM crm.wa_conversations
      WHERE created_at >= $1 AND created_at < $2`,
      periodParams
    ),
    query(
      `SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date AS tanggal,
              COUNT(*)::int AS conversations,
              COUNT(*) FILTER (WHERE is_complaint)::int AS complaints,
              COUNT(*) FILTER (WHERE sla_response_breached)::int AS sla_breached
         FROM crm.wa_conversations
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1
        ORDER BY 1`,
      periodParams
    ),
    query(
      `SELECT COALESCE(category, 'belum_dikategorikan') AS category,
              priority,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
              AVG(resolution_seconds) FILTER (WHERE resolution_seconds IS NOT NULL)
                AS avg_resolution_seconds
         FROM crm.wa_conversations
        WHERE is_complaint AND created_at >= $1 AND created_at < $2
        GROUP BY 1, 2
        ORDER BY total DESC`,
      periodParams
    ),
    query(
      `SELECT csat_score AS score, COUNT(*)::int AS total
         FROM crm.wa_conversations
        WHERE csat_score IS NOT NULL AND created_at >= $1 AND created_at < $2
        GROUP BY 1
        ORDER BY 1`,
      periodParams
    ),
    query(
      `SELECT u.full_name AS agent_name,
              COUNT(*)::int AS handled,
              COUNT(*) FILTER (WHERE v.status = 'resolved')::int AS resolved,
              AVG(v.first_response_seconds) FILTER (WHERE v.first_response_seconds IS NOT NULL)
                AS avg_first_response_seconds,
              AVG(v.csat_score) FILTER (WHERE v.csat_score IS NOT NULL) AS avg_csat
         FROM crm.wa_conversations v
         JOIN configuration.users u ON u.id = v.assigned_user_id
        WHERE v.created_at >= $1 AND v.created_at < $2
        GROUP BY u.full_name
        ORDER BY handled DESC
        LIMIT 20`,
      periodParams
    ),
    // Pecahan per kanal (EPIC-013 Fase B) — agar volume & mutu layanan
    // WhatsApp vs Instagram bisa dibandingkan.
    query(
      `SELECT channel,
              COUNT(*)::int AS conversations,
              COUNT(*) FILTER (WHERE is_complaint)::int AS complaints,
              COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
              AVG(first_response_seconds) FILTER (WHERE first_response_seconds IS NOT NULL)
                AS avg_first_response_seconds,
              AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL) AS avg_csat
         FROM crm.wa_conversations
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY channel
        ORDER BY conversations DESC`,
      periodParams
    ),
    // Ringkasan Google Review (EPIC-013) — ulasan ikut beban kerja CS,
    // jadi angkanya tampil berdampingan dengan chat. Periode memakai waktu
    // ulasan terbit menurut Google, konsisten dengan SLA balasnya.
    queryOne(
      `SELECT COUNT(*)::int AS total_reviews,
              AVG(star_rating)::numeric(3,2) AS avg_rating,
              COUNT(*) FILTER (WHERE reply_comment IS NOT NULL)::int AS replied,
              COUNT(*) FILTER (WHERE star_rating <= 2)::int AS low_rating
         FROM crm.google_reviews
        WHERE review_created_at >= $1 AND review_created_at < $2`,
      periodParams
    ),
  ]);

  const toNum = (value: unknown) =>
    value == null ? null : Math.round(Number(value) * 100) / 100;

  return {
    period: { from: period.fromIso, to: period.toIso },
    summary: {
      total_conversations: summaryRow?.total_conversations ?? 0,
      total_complaints: summaryRow?.total_complaints ?? 0,
      total_resolved: summaryRow?.total_resolved ?? 0,
      total_sla_breached: summaryRow?.total_sla_breached ?? 0,
      avg_first_response_seconds: toNum(summaryRow?.avg_first_response_seconds),
      avg_resolution_seconds: toNum(summaryRow?.avg_resolution_seconds),
      avg_csat: toNum(summaryRow?.avg_csat),
      csat_responses: summaryRow?.csat_responses ?? 0,
    },
    daily: dailyRows.map((row) => ({
      tanggal: row.tanggal,
      conversations: row.conversations,
      complaints: row.complaints,
      sla_breached: row.sla_breached,
    })),
    categories: categoryRows.map((row) => ({
      category: row.category,
      priority: row.priority,
      total: row.total,
      resolved: row.resolved,
      avg_resolution_seconds: toNum(row.avg_resolution_seconds),
    })),
    csat_distribution: csatRows.map((row) => ({
      score: Number(row.score),
      total: row.total,
    })),
    channels: channelRows.map((row) => ({
      channel: row.channel,
      conversations: row.conversations,
      complaints: row.complaints,
      resolved: row.resolved,
      avg_first_response_seconds: toNum(row.avg_first_response_seconds),
      avg_csat: toNum(row.avg_csat),
    })),
    reviews: {
      total: reviewRow?.total_reviews ?? 0,
      avg_rating: toNum(reviewRow?.avg_rating),
      replied: reviewRow?.replied ?? 0,
      low_rating: reviewRow?.low_rating ?? 0,
    },
    agents: agentRows.map((row) => ({
      agent_name: row.agent_name,
      handled: row.handled,
      resolved: row.resolved,
      avg_first_response_seconds: toNum(row.avg_first_response_seconds),
      avg_csat: toNum(row.avg_csat),
    })),
  };
}
