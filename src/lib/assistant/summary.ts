import { contextSizeChars, selectContextForIntent, type AssistantIntent } from "@/lib/assistant/context";

/**
 * Ringkasan data operasional untuk asisten Do: hitungan per modul + beberapa
 * baris terbaru sesuai intent, dan jawaban cadangan saat layanan AI tidak
 * terjangkau.
 */

type Intent = AssistantIntent;
export type DetailRow = Record<string, unknown>;
type DbQueryResult = { data?: unknown[] | null; error?: unknown; count?: number | null };
export type DbQuery = PromiseLike<DbQueryResult> & {
  eq(column: string, value: unknown): DbQuery;
  gte(column: string, value: unknown): DbQuery;
  lt(column: string, value: unknown): DbQuery;
  in(column: string, values: readonly unknown[]): DbQuery;
  order(column: string, options?: { ascending?: boolean }): DbQuery;
  limit(count: number): DbQuery;
  select(columns?: string): DbQuery;
  single(): PromiseLike<{ data?: Record<string, unknown> | null; error?: unknown }>;
};
/** Bentuk minimal shim PostgREST yang dipakai modul asisten. */
export type DbAdmin = {
  from(table: string): {
    select(columns?: string, options?: Record<string, unknown>): DbQuery;
    insert(values: unknown): DbQuery;
    update(values: unknown): DbQuery;
    delete(): DbQuery;
  };
};
export type Summary = {
  generatedAt: string;
  hris: Record<string, number>;
  performance: Record<string, number>;
  payroll: Record<string, number>;
  procurement: Record<string, number>;
  pos: Record<string, number>;
  inventory: Record<string, number>;
  master: Record<string, number>;
  integration: Record<string, number>;
  modules: Record<string, { label: string; metrics: Record<string, number> }>;
  details: Partial<Record<Intent, DetailRow[]>>;
};

/** Log ukuran konteks: bukti penghematan Fase C, bukan klaim. */
export function logContextSaving(summary: Summary, intent: Intent) {
  const before = contextSizeChars(summary);
  const after = contextSizeChars(selectContextForIntent(summary, intent));
  const saved = before === 0 ? 0 : Math.round(((before - after) / before) * 100);
  console.info(`[do:context] intent=${intent} ${before} -> ${after} char (hemat ${saved}%)`);
}

export function detectIntent(message: string): Intent {
  const lower = message.toLowerCase();
  if (lower.includes("kpi") || lower.includes("performance") || lower.includes("review") || lower.includes("penilaian")) return "performance";
  if (lower.includes("payroll") || lower.includes("gaji") || lower.includes("salary") || lower.includes("benefit") || lower.includes("loan")) return "payroll";
  if (lower.includes("integration") || lower.includes("integrasi") || lower.includes("webhook") || lower.includes("api") || lower.includes("ai assistant")) return "integration";
  if (lower.includes("master") || lower.includes("department") || lower.includes("departemen") || lower.includes("position") || lower.includes("jabatan")) return "master";
  if (lower.includes("hr") || lower.includes("kandidat") || lower.includes("candidate") || lower.includes("employee") || lower.includes("karyawan") || lower.includes("attendance") || lower.includes("absen") || lower.includes("leave") || lower.includes("cuti")) return "hris";
  if (lower.includes("procurement") || lower.includes("purchasing") || lower.includes("po") || lower.includes("pr") || lower.includes("supplier")) return "procurement";
  if (lower.includes("pos") || lower.includes("sales") || lower.includes("order") || lower.includes("reservasi")) return "pos";
  if (lower.includes("stock") || lower.includes("stok") || lower.includes("inventory") || lower.includes("bahan")) return "inventory";
  return "all";
}

async function safeCount(
  admin: DbAdmin,
  table: string,
  filter?: (query: DbQuery) => DbQuery,
): Promise<number> {
  try {
    let query = admin.from(table).select("id", { count: "exact", head: true }) as unknown as DbQuery;
    if (filter) query = filter(query);
    const { count, error } = await query;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function safeRows(
  admin: DbAdmin,
  table: string,
  columns: string,
  options?: {
    filter?: (query: DbQuery) => DbQuery;
    order?: { column: string; ascending?: boolean };
    limit?: number;
  },
): Promise<DetailRow[]> {
  try {
    let query = admin.from(table).select(columns) as unknown as DbQuery;
    if (options?.filter) query = options.filter(query);
    if (options?.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? false });
    if (options?.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error || !data) return [];
    return data as DetailRow[];
  } catch {
    return [];
  }
}

export async function buildSystemSummary(admin: DbAdmin, intent: Intent): Promise<Summary> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [
    candidatesTotal,
    candidatesToday,
    candidatesNew,
    employeesTotal,
    attendanceToday,
    leavesTotal,
    jobOpeningsTotal,
    performanceReviewsTotal,
    employeeKpisTotal,
    kpiTemplatesTotal,
    developmentPlansTotal,
    payrollRunsTotal,
    payrollDetailsTotal,
    employeeSalaryTotal,
    benefitsTotal,
    loansTotal,
    purchaseRequestsTotal,
    purchaseOrdersTotal,
    purchaseOrdersPending,
    suppliersTotal,
    rawMaterialsTotal,
    inventoryItems,
    lowStockItems,
    inventoryMovementsTotal,
    productsTotal,
    posOrdersTotal,
    posReservationsTotal,
    posCustomersTotal,
    posShiftsTotal,
    departmentsTotal,
    positionsTotal,
    employmentStatusesTotal,
    usersTotal,
    notificationsTotal,
    aiAssistantLogsTotal,
  ] = await Promise.all([
    safeCount(admin, "candidates"),
    safeCount(admin, "candidates", (q) => q.gte("created_at", todayIso)),
    safeCount(admin, "candidates", (q) => q.eq("status", "applied")),
    safeCount(admin, "employees"),
    safeCount(admin, "attendance", (q) => q.gte("created_at", todayIso)),
    safeCount(admin, "leaves"),
    safeCount(admin, "job_openings"),
    safeCount(admin, "performance_reviews"),
    safeCount(admin, "employee_kpis"),
    safeCount(admin, "kpi_templates"),
    safeCount(admin, "development_plans"),
    safeCount(admin, "payroll_runs"),
    safeCount(admin, "payroll_details"),
    safeCount(admin, "employee_salary"),
    safeCount(admin, "benefits"),
    safeCount(admin, "loans"),
    safeCount(admin, "purchase_requests"),
    safeCount(admin, "purchase_orders"),
    safeCount(admin, "purchase_orders", (q) => q.in("status", ["draft", "pending", "pending_approval", "sent", "pending_head", "pending_finance", "pending_direksi"])),
    safeCount(admin, "suppliers"),
    safeCount(admin, "raw_materials"),
    safeCount(admin, "inventory"),
    safeCount(admin, "inventory", (q) => q.lt("current_stock", 1)),
    safeCount(admin, "inventory_movements"),
    safeCount(admin, "products"),
    safeCount(admin, "pos_orders"),
    safeCount(admin, "pos_reservations"),
    safeCount(admin, "pos_customers"),
    safeCount(admin, "pos_shifts"),
    safeCount(admin, "departments"),
    safeCount(admin, "positions"),
    safeCount(admin, "employment_statuses"),
    safeCount(admin, "users"),
    safeCount(admin, "notifications"),
    safeCount(admin, "ai_assistant_logs"),
  ]);

  const details: Summary["details"] = {};
  if (intent === "all" || intent === "hris") {
    details.hris = await safeRows(admin, "candidates", "id, full_name, status, source, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "performance") {
    details.performance = await safeRows(admin, "performance_reviews", "id, period_label, status, grand_total_score, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "payroll") {
    details.payroll = await safeRows(admin, "payroll_runs", "id, period_start, period_end, status, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "procurement") {
    details.procurement = await safeRows(admin, "purchase_orders", "id, po_number, status, total_amount, created_at", {
      filter: (q) => q.in("status", ["draft", "pending", "pending_approval", "sent", "pending_head", "pending_finance", "pending_direksi"]),
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "inventory") {
    details.inventory = await safeRows(admin, "inventory", "id, current_stock, minimum_stock, raw_material_id, updated_at", {
      filter: (q) => q.lt("current_stock", 1),
      order: { column: "updated_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "pos") {
    details.pos = await safeRows(admin, "pos_orders", "id, order_number, status, total_amount, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "integration") {
    details.integration = await safeRows(admin, "ai_assistant_logs", "id, user_email, intent, model, latency_ms, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "master") {
    details.master = await safeRows(admin, "departments", "id, name, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }

  const hris = { candidatesTotal, candidatesToday, candidatesNew, employeesTotal, attendanceToday, leavesTotal, jobOpeningsTotal };
  const performance = { performanceReviewsTotal, employeeKpisTotal, kpiTemplatesTotal, developmentPlansTotal };
  const payroll = { payrollRunsTotal, payrollDetailsTotal, employeeSalaryTotal, benefitsTotal, loansTotal };
  const procurement = { purchaseRequestsTotal, purchaseOrdersTotal, purchaseOrdersPending, suppliersTotal, rawMaterialsTotal };
  const inventory = { inventoryItems, lowStockItems, inventoryMovementsTotal, productsTotal };
  const pos = { posOrdersTotal, posReservationsTotal, posCustomersTotal, posShiftsTotal };
  const master = { departmentsTotal, positionsTotal, employmentStatusesTotal, usersTotal };
  const integration = { notificationsTotal, aiAssistantLogsTotal };

  return {
    generatedAt: new Date().toISOString(),
    hris,
    performance,
    payroll,
    procurement,
    pos,
    inventory,
    master,
    integration,
    modules: {
      hris: { label: "HRIS", metrics: hris },
      performance: { label: "Performance", metrics: performance },
      payroll: { label: "Payroll", metrics: payroll },
      procurement: { label: "Procurement", metrics: procurement },
      inventory: { label: "Inventory", metrics: inventory },
      pos: { label: "POS", metrics: pos },
      master: { label: "Master Data", metrics: master },
      integration: { label: "Integration", metrics: integration },
    },
    details,
  };
}

export function createEmptySystemSummary(): Summary {
  const empty: Record<string, number> = {};
  return {
    generatedAt: new Date().toISOString(),
    hris: empty,
    performance: empty,
    payroll: empty,
    procurement: empty,
    pos: empty,
    inventory: empty,
    master: empty,
    integration: empty,
    modules: {},
    details: {},
  };
}

export function generateSummaryAnswer(message: string, summary: Summary, name: string, intent: Intent): string {
  const lower = message.toLowerCase();
  const sections: string[] = [];
  const includeAll = intent === "all" || !lower || lower.includes("semua") || lower.includes("summary") || lower.includes("ringkas") || lower.includes("overview");

  if (includeAll) {
    sections.push(`Halo ${name}, berikut ringkasan NüHabit OS saat ini:`);
    sections.push(formatHris(summary));
    sections.push(formatPerformance(summary));
    sections.push(formatPayroll(summary));
    sections.push(formatProcurement(summary));
    sections.push(formatInventory(summary));
    sections.push(formatPos(summary));
    sections.push(formatMaster(summary));
    sections.push(formatIntegration(summary));
    sections.push(formatDetails(summary));
    sections.push("Prioritas: cek kandidat baru, review performance, PO pending, inventory low stock, dan aktivitas POS terbaru.");
    return sections.filter(Boolean).join("\n\n");
  }

  if (intent === "hris") return [formatHris(summary), formatDetails(summary, "hris")].filter(Boolean).join("\n\n");
  if (intent === "performance") return [formatPerformance(summary), formatDetails(summary, "performance")].filter(Boolean).join("\n\n");
  if (intent === "payroll") return [formatPayroll(summary), formatDetails(summary, "payroll")].filter(Boolean).join("\n\n");
  if (intent === "procurement") return [formatProcurement(summary), formatDetails(summary, "procurement")].filter(Boolean).join("\n\n");
  if (intent === "pos") return [formatPos(summary), formatDetails(summary, "pos")].filter(Boolean).join("\n\n");
  if (intent === "inventory") return [formatInventory(summary), formatDetails(summary, "inventory")].filter(Boolean).join("\n\n");
  if (intent === "master") return [formatMaster(summary), formatDetails(summary, "master")].filter(Boolean).join("\n\n");
  if (intent === "integration") return [formatIntegration(summary), formatDetails(summary, "integration")].filter(Boolean).join("\n\n");

  return [
    formatHris(summary),
    formatPerformance(summary),
    formatPayroll(summary),
    formatProcurement(summary),
    formatInventory(summary),
    formatPos(summary),
    formatMaster(summary),
    formatIntegration(summary),
  ].join("\n\n");
}

function formatHris(summary: Summary) {
  return `HRIS: ${summary.hris.candidatesTotal ?? 0} total kandidat, ${summary.hris.candidatesToday ?? 0} kandidat masuk hari ini, ${summary.hris.candidatesNew ?? 0} kandidat status new, ${summary.hris.employeesTotal ?? 0} karyawan, ${summary.hris.attendanceToday ?? 0} attendance hari ini, ${summary.hris.leavesTotal ?? 0} leave request, ${summary.hris.jobOpeningsTotal ?? 0} job opening.`;
}

function formatPerformance(summary: Summary) {
  return `Performance: ${summary.performance.performanceReviewsTotal ?? 0} review, ${summary.performance.employeeKpisTotal ?? 0} employee KPI, ${summary.performance.kpiTemplatesTotal ?? 0} template KPI, ${summary.performance.developmentPlansTotal ?? 0} development plan.`;
}

function formatPayroll(summary: Summary) {
  return `Payroll: ${summary.payroll.payrollRunsTotal ?? 0} payroll run, ${summary.payroll.payrollDetailsTotal ?? 0} payroll detail, ${summary.payroll.employeeSalaryTotal ?? 0} salary record, ${summary.payroll.benefitsTotal ?? 0} benefit, ${summary.payroll.loansTotal ?? 0} loan.`;
}

function formatProcurement(summary: Summary) {
  return `Procurement: ${summary.procurement.purchaseRequestsTotal ?? 0} PR, ${summary.procurement.purchaseOrdersTotal ?? 0} PO, ${summary.procurement.purchaseOrdersPending ?? 0} PO perlu perhatian, ${summary.procurement.suppliersTotal ?? 0} supplier, ${summary.procurement.rawMaterialsTotal ?? 0} raw material.`;
}

function formatPos(summary: Summary) {
  return `POS: ${summary.pos.posOrdersTotal ?? 0} order, ${summary.pos.posReservationsTotal ?? 0} reservasi, ${summary.pos.posCustomersTotal ?? 0} customer, ${summary.pos.posShiftsTotal ?? 0} shift.`;
}

function formatInventory(summary: Summary) {
  return `Inventory: ${summary.inventory.inventoryItems ?? 0} item inventory, ${summary.inventory.lowStockItems ?? 0} item low/empty stock, ${summary.inventory.inventoryMovementsTotal ?? 0} movement, ${summary.inventory.productsTotal ?? 0} product.`;
}

function formatMaster(summary: Summary) {
  return `Master Data: ${summary.master.departmentsTotal ?? 0} department, ${summary.master.positionsTotal ?? 0} position, ${summary.master.employmentStatusesTotal ?? 0} employment status, ${summary.master.usersTotal ?? 0} user.`;
}

function formatIntegration(summary: Summary) {
  return `Integration: ${summary.integration.notificationsTotal ?? 0} notification, ${summary.integration.aiAssistantLogsTotal ?? 0} AI assistant log.`;
}

function formatDetails(summary: Summary, only?: Intent) {
  const lines: string[] = [];
  const add = (label: string, rows?: DetailRow[]) => {
    if (!rows?.length) return;
    lines.push(`${label}: ${rows.slice(0, 5).map((row) => Object.values(row).filter(Boolean).slice(0, 4).join(" | ")).join("; ")}`);
  };
  if (!only || only === "hris") add("Kandidat terbaru", summary.details.hris);
  if (!only || only === "performance") add("Performance review terbaru", summary.details.performance);
  if (!only || only === "payroll") add("Payroll run terbaru", summary.details.payroll);
  if (!only || only === "procurement") add("PO pending terbaru", summary.details.procurement);
  if (!only || only === "inventory") add("Inventory low stock", summary.details.inventory);
  if (!only || only === "pos") add("POS order terbaru", summary.details.pos);
  if (!only || only === "master") add("Master data terbaru", summary.details.master);
  if (!only || only === "integration") add("AI assistant activity", summary.details.integration);
  return lines.join("\n");
}
