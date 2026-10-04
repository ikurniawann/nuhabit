export type CrmReportTopSpender = {
  id: string;
  name: string;
  phone: string;
  membership_tier: string;
  member_type: string;
  order_count: number;
  total_spend: number;
  ark_spend: number;
  last_order_at: string | null;
};

export type CrmReportFrequentVisitor = {
  id: string;
  name: string;
  phone: string;
  membership_tier: string;
  member_type: string;
  order_count: number;
  visit_days: number;
  lifetime_visits: number;
  last_visit_at: string | null;
};

export type CrmReportVenueRow = {
  company_id: string | null;
  branch_id: string | null;
  company_name: string;
  branch_name: string;
  topup_amount: number;
  bonus_amount: number;
  /** Topup FOC (gratis, marketing) — dipisah dari topup berbayar. */
  foc_topup_amount: number;
  spend_amount: number;
  other_amount: number;
  topup_count: number;
  foc_topup_count: number;
  payment_count: number;
  net_flow: number;
};

export type CrmReportData = {
  period: { from: string; to: string };
  topSpenders: CrmReportTopSpender[];
  frequentVisitors: CrmReportFrequentVisitor[];
  reconciliation: {
    venues: CrmReportVenueRow[];
    totals: {
      topup_amount: number;
      bonus_amount: number;
      foc_topup_amount: number;
      spend_amount: number;
      net_flow: number;
    };
    outstanding_balance: number;
    /** Topup yang belum bertanda venue — di luar tabel per-venue. */
    untagged_topup_amount?: number;
    untagged_topup_count?: number;
  };
  members: {
    card: number;
    registered: number;
  };
};

export type CrmReportPeriodInput = {
  from: string;
  to: string;
};

/** EPIC-012 Fase E — laporan customer service. */
export interface CsReportSummary {
  total_conversations: number;
  total_complaints: number;
  total_resolved: number;
  total_sla_breached: number;
  avg_first_response_seconds: number | null;
  avg_resolution_seconds: number | null;
  avg_csat: number | null;
  csat_responses: number;
}

export interface CsReportData {
  period: { from: string; to: string };
  summary: CsReportSummary;
  daily: {
    tanggal: string;
    conversations: number;
    complaints: number;
    sla_breached: number;
  }[];
  categories: {
    category: string;
    priority: string;
    total: number;
    resolved: number;
    avg_resolution_seconds: number | null;
  }[];
  csat_distribution: { score: number; total: number }[];
  channels: {
    channel: string;
    conversations: number;
    complaints: number;
    resolved: number;
    avg_first_response_seconds: number | null;
    avg_csat: number | null;
  }[];
  /** EPIC-013 — ringkasan Google Review periode berjalan. */
  reviews: {
    total: number;
    avg_rating: number | null;
    replied: number;
    low_rating: number;
  };
  agents: {
    agent_name: string;
    handled: number;
    resolved: number;
    avg_first_response_seconds: number | null;
    avg_csat: number | null;
  }[];
}

/**
 * EPIC-029 — laporan analitik percakapan (ringkasan AI + kata kunci).
 * Bebas PII: tidak ada isi chat, ringkasan per percakapan, nomor, maupun nama.
 */
export interface ConversationInsightReportData {
  period: { from: string; to: string };
  summary: {
    total_conversations: number;
    analyzed: number;
    not_analyzed: number;
    complaints: number;
    sentiment: { positif: number; netral: number; negatif: number };
  };
  keywords: { keyword: string; count: number; conversations: number }[];
  topics: { topic: string; count: number }[];
}

/** Hasil batch "Analisa percakapan baru". */
export interface AnalyzeBatchResult {
  summary: {
    requested: number;
    analyzed: number;
    cached: number;
    empty: number;
    failed: number;
  };
  results: {
    conversation_id: string;
    status: "cache" | "analyzed" | "empty" | "failed";
    error?: string;
  }[];
}
