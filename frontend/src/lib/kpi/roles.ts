/** Role yang boleh menjalankan snapshot KPI & melihat semua scorecard. */
export const KPI_MANAGE_ROLES = ["super_admin", "admin", "hrd"] as const;

/** Role yang punya scorecard (sinkron dgn seed kpi_role_indicators). */
export const KPI_SCORECARD_ROLES = [
  "pos",
  "pos_supervisor",
  "warehouse_staff",
  "warehouse_admin",
  "purchasing_staff",
  "purchasing_admin",
  "purchasing_manager",
  "finance_staff",
  "hrd",
  "hiring_manager",
  "qc_staff",
  "employee",
] as const;
