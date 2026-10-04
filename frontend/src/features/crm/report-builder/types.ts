import type {
  Aggregation, ChartType, DateBucket, DatePreset, FilterOp, ReportDataset, ReportDefinition, ReportFieldType,
} from "@/lib/crm/report-builder";
import type { ScheduleChannel, ScheduleFrequency, ScheduleRecipient } from "@/lib/crm/report-schedule";

export type {
  Aggregation, ChartType, DateBucket, DatePreset, FilterOp, ReportDataset, ReportDefinition, ReportFieldType,
  ScheduleChannel, ScheduleFrequency, ScheduleRecipient,
};

export interface DatasetFieldMeta {
  key: string;
  label: string;
  type: ReportFieldType;
  options: string[] | null;
  aggregatable: boolean;
}

export interface DatasetMeta {
  key: ReportDataset;
  label: string;
  date_field: string;
  default_columns: string[];
  fields: DatasetFieldMeta[];
}

export interface RegistryOption<T extends string = string> {
  key: T;
  label: string;
}

export interface ReportRegistry {
  datasets: DatasetMeta[];
  filter_ops: RegistryOption<FilterOp>[];
  date_presets: RegistryOption<DatePreset>[];
  date_buckets: RegistryOption<DateBucket>[];
  aggregations: RegistryOption<Aggregation>[];
  chart_types: RegistryOption<ChartType>[];
}

export interface ReportResultColumn {
  key: string;
  label: string;
  type: ReportFieldType | "number";
  isAggregate: boolean;
}

export interface ReportResult {
  columns: ReportResultColumn[];
  rows: Array<Record<string, unknown>>;
  grouped: boolean;
  dataset: ReportDataset;
  row_count: number;
  truncated: boolean;
}

export interface SavedReport {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  dataset: ReportDataset;
  definition: ReportDefinition;
  is_shared: boolean;
  created_by: string | null;
  creator_name: string | null;
  created_at: string;
  updated_at: string;
  active_schedules?: number | string;
}

export interface DashboardRow {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  is_default: boolean;
  created_by: string | null;
  creator_name: string | null;
  widget_count: number | string;
  created_at: string;
  updated_at: string;
}

export interface DashboardWidget {
  id: string;
  report_id: string;
  title: string;
  widget_type: "chart" | "kpi" | "table";
  width: number;
  sort_order: number;
  report_name: string;
  dataset: ReportDataset;
  definition: ReportDefinition | null;
  result: ReportResult | null;
}

export interface DashboardDetail {
  dashboard: DashboardRow;
  widgets: DashboardWidget[];
}

export interface WidgetInput {
  report_id: string;
  title?: string | null;
  widget_type: "chart" | "kpi" | "table";
  width: number;
}

export interface ScheduleRow {
  id: string;
  company_id: string | null;
  report_id: string;
  name: string;
  frequency: ScheduleFrequency;
  hour: number;
  day_of_week: number | null;
  day_of_month: number | null;
  channel: ScheduleChannel;
  recipients: ScheduleRecipient[];
  is_active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  next_run_at: string | null;
  created_at: string;
  report_name: string;
  dataset: ReportDataset;
}

export interface ScheduleInput {
  report_id: string;
  name: string;
  frequency: ScheduleFrequency;
  hour: number;
  day_of_week?: number | null;
  day_of_month?: number | null;
  channel: ScheduleChannel;
  recipients: ScheduleRecipient[];
  is_active: boolean;
}
