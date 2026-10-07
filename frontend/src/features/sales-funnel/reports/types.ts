export interface FunnelStageRow {
  id: string;
  name: string;
  code: string;
  sort_order: number;
  is_won: boolean;
  reached: string | number;
}

export interface BreakdownRow {
  key: string;
  total: string | number;
  won: string | number;
  won_value: string | null;
}

export interface UpcomingEventRow {
  id: string;
  title: string;
  event_type: string;
  event_date: string;
  pax_estimate: number | null;
  value_final: string | null;
  org_name: string;
  pic_name: string;
  pic_phone: string;
}

export interface LostReasonRow {
  key: string;
  total: string | number;
}

export interface FunnelReport {
  period: { from: string; to: string };
  funnel: FunnelStageRow[];
  summary: {
    total_created: number;
    won: number;
    lost: number;
    won_value: string | null;
    open_count: number;
    pipeline_value: string | null;
  };
  by_org_type: BreakdownRow[];
  by_event_type: BreakdownRow[];
  by_source: BreakdownRow[];
  by_owner: BreakdownRow[];
  upcoming_events: UpcomingEventRow[];
  lost_reasons: LostReasonRow[];
}

export interface ReportFilters {
  from: string;
  to: string;
}
