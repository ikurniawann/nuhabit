import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import {
  AGGREGATION_LABELS, AGGREGATIONS, CHART_TYPE_LABELS, CHART_TYPES, DATE_BUCKET_LABELS, DATE_BUCKETS,
  DATE_PRESET_LABELS, DATE_PRESETS, FILTER_OP_LABELS, FILTER_OPS, REPORT_DATASET_DEFS, REPORT_DATASETS,
} from "@/lib/crm/report-builder";

/** EPIC-050 T-4.1 — metadata registry untuk UI builder (tanpa ekspresi SQL). */
export const GET = apiHandler(async () => {
  await requireCrmUser("reports");
  const datasets = REPORT_DATASETS.map((key) => {
    const ds = REPORT_DATASET_DEFS[key];
    return {
      key,
      label: ds.label,
      date_field: ds.dateField,
      default_columns: ds.defaultColumns,
      fields: Object.entries(ds.fields).map(([fieldKey, f]) => ({
        key: fieldKey, label: f.label, type: f.type, options: f.options ?? null, aggregatable: Boolean(f.aggregatable),
      })),
    };
  });
  return successResponse({
    datasets,
    filter_ops: FILTER_OPS.map((op) => ({ key: op, label: FILTER_OP_LABELS[op] })),
    date_presets: DATE_PRESETS.map((p) => ({ key: p, label: DATE_PRESET_LABELS[p] })),
    date_buckets: DATE_BUCKETS.map((b) => ({ key: b, label: DATE_BUCKET_LABELS[b] })),
    aggregations: AGGREGATIONS.map((a) => ({ key: a, label: AGGREGATION_LABELS[a] })),
    chart_types: CHART_TYPES.map((c) => ({ key: c, label: CHART_TYPE_LABELS[c] })),
  });
}, "crm.report-builder.datasets.GET");
