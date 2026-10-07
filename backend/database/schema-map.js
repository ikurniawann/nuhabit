/**
 * Sumber kebenaran tunggal pemetaan tabel -> domain (per schema).
 *
 * Dipakai oleh:
 *   - database/scripts/generate-from-db.js   (tulis file per domain)
 *   - database/scripts/apply-migrations.js   (discovery rekursif)
 *
 * MODE SCHEMA:
 *   - `useRealSchemas = true` (sekarang): tabel dipindah ke schema PostgreSQL
 *     asli sesuai `realSchema` per domain (mis. `hris.employees`,
 *     `crm.crm_rewards`). Enum/function/view tetap di `public`; referensi tabel
 *     yang "bare" (tanpa prefix) di-resolve lewat `search_path` global.
 *   - `useRealSchemas = false`: semua tabel tetap di `public` (mode lama, file
 *     hanya diorganisir per folder tanpa mengubah schema fisik).
 */

const useRealSchemas = true;

/**
 * Definisi domain. `order` menentukan urutan folder & apply.
 * `schema`     = schema saat ini (mode hybrid, mayoritas "public").
 * `realSchema` = target schema asli ketika useRealSchemas = true.
 */
const DOMAINS = {
  iam: { order: 10, schema: "iam", realSchema: "iam" },
  configuration: { order: 20, schema: "public", realSchema: "configuration" },
  hris: { order: 30, schema: "public", realSchema: "hris" },
  performance: { order: 35, schema: "public", realSchema: "performance" },
  recruitment: { order: 38, schema: "public", realSchema: "recruitment" },
  item: { order: 40, schema: "public", realSchema: "item" },
  purchasing: { order: 45, schema: "public", realSchema: "purchasing" },
  inventory: { order: 50, schema: "public", realSchema: "inventory" },
  manufacturing: { order: 55, schema: "public", realSchema: "manufacturing" },
  pos: { order: 60, schema: "public", realSchema: "pos" },
  ticketing: { order: 65, schema: "public", realSchema: "ticketing" },
  // EPIC-032 — engine promosi lintas modul (ticketing + pos)
  promo: { order: 68, schema: "public", realSchema: "promo" },
  crm: { order: 70, schema: "public", realSchema: "crm" },
  accounting: { order: 75, schema: "public", realSchema: "accounting" },
  // Dataroom — penyimpanan dokumen + link berbagi (owner 2026-09-04)
  dataroom: { order: 78, schema: "dataroom", realSchema: "dataroom" },
  core: { order: 90, schema: "public", realSchema: "public" },
};

/** Pemetaan eksplisit tabel (schema public) -> domain. */
const TABLE_DOMAIN = {
  // ── configuration (identitas & audit app-level) ──────────────────────────
  users: "configuration",
  user_approval_permissions: "configuration",
  user_warehouses: "configuration",
  payment_gateways: "configuration",
  admin_user_audit_logs: "configuration",
  activity_logs: "configuration",

  // ── hris (HR inti) ───────────────────────────────────────────────────────
  employees: "hris",
  departments: "hris",
  sections: "hris",
  positions: "hris",
  employment_history: "hris",
  employment_statuses: "hris",
  employee_benefits: "hris",
  employee_documents: "hris",
  employee_kpis: "hris",
  employee_salary: "hris",
  employee_schedules: "hris",
  attendance: "hris",
  leaves: "hris",
  leave_balances: "hris",
  loans: "hris",
  benefits: "hris",
  payroll_details: "hris",
  payroll_runs: "hris",
  payroll_settings: "hris",
  payroll_tax_config: "hris",
  onboarding_checklists: "hris",
  offboarding_checklists: "hris",
  development_plans: "hris",
  project_assignments: "hris",
  staff: "hris",
  // staff_schedules & staff_sections di-drop di EPIC-015 Fase C
  // (migrasi 20260720200000). Jadwal hidup di shifts + employee_shifts.
  hris_logbook_entries: "hris",
  hris_logbook_entry_items: "hris",
  hris_logbook_templates: "hris",
  hris_logbook_template_items: "hris",

  // ── performance (manajemen kinerja & 360 feedback) ───────────────────────
  kpi_templates: "performance",
  kpi_template_items: "performance",
  kpi_template_behavioral: "performance",
  performance_categories: "performance",
  performance_reviews: "performance",
  behavioral_assessments: "performance",
  behavioral_review_items: "performance",
  behavioral_standards: "performance",
  feedback_assignments: "performance",
  feedback_categories: "performance",
  feedback_criteria: "performance",
  feedback_cycles: "performance",
  feedback_relationship_types: "performance",
  feedback_responses: "performance",
  feedback_summaries: "performance",
  score_scales: "performance",

  // ── recruitment (rekrutmen) ──────────────────────────────────────────────
  candidates: "recruitment",
  interviews: "recruitment",
  job_openings: "recruitment",

  // ── item (master data material/produk/satuan) ────────────────────────────
  raw_materials: "item",
  raw_material_unit_conversions: "item",
  products: "item",
  units: "item",
  brands: "item",

  // ── purchasing ───────────────────────────────────────────────────────────
  suppliers: "purchasing",
  vendors: "purchasing",
  vendor_documents: "purchasing",
  vendor_payments: "purchasing",
  purchase_orders: "purchasing",
  purchase_order_items: "purchasing",
  purchase_order_payment_terms: "purchasing",
  purchase_requests: "purchasing",
  pr_items: "purchasing",
  purchase_returns: "purchasing",
  purchase_return_items: "purchasing",
  vendor_credits: "purchasing",
  vendor_credit_items: "purchasing",
  grn: "purchasing",
  grn_items: "purchasing",
  grn_qc_inspections: "purchasing",
  grn_qc_inspection_items: "purchasing",
  deliveries: "purchasing",
  supplier_price_lists: "purchasing",
  vendor_price_lists: "purchasing",
  cogs_additional_costs: "purchasing",

  // ── inventory ────────────────────────────────────────────────────────────
  inventory: "inventory",
  inventory_movements: "inventory",
  stock_opnames: "inventory",
  stock_opname_lines: "inventory",
  product_stock_opnames: "inventory",
  product_stock_opname_lines: "inventory",
  finished_goods_inventory: "inventory",
  finished_goods_movements: "inventory",

  // ── manufacturing (produksi) ─────────────────────────────────────────────
  production_orders: "manufacturing",
  production_order_materials: "manufacturing",
  production_batches: "manufacturing",
  bom_items: "manufacturing",
  raw_material_bom_items: "manufacturing",

  // ── core / public (lintas domain, fisik di schema public → folder schemas/public/) ──
  notifications: "core",
  notifications_log: "core",
  ai_assistant_sessions: "core",
  ai_assistant_messages: "core",
};

/** Tentukan domain dari nama tabel + schema asalnya. */
function domainForTable(table, schema) {
  if (schema === "iam") return "iam";
  if (schema === "auth") return "iam"; // auth ikut grup identitas (file manual)
  if (table.startsWith("pos_")) return "pos";
  if (table.startsWith("crm_")) return "crm";
  if (table.startsWith("account_") || table === "chart_of_accounts") return "accounting";
  return TABLE_DOMAIN[table] || "core";
}

/** Nama folder domain (tanpa nomor), mis. "hris". Tabel `public` → `schemas/public/`. */
function folderForDomain(domain) {
  if (domain === "core") return "public";
  return domain;
}

/** Schema target untuk domain sesuai mode aktif. */
function schemaForDomain(domain) {
  const def = DOMAINS[domain] || DOMAINS.core;
  return useRealSchemas ? def.realSchema : def.schema;
}

/** Schema asli (real) untuk domain, terlepas dari mode aktif. */
function realSchemaForDomain(domain) {
  const def = DOMAINS[domain] || DOMAINS.core;
  return def.realSchema;
}

/**
 * Daftar schema asli yang perlu dibuat (selain `public`), terurut sesuai
 * `order` domain. Mis: ["iam", "configuration", "hris", ...].
 */
function allRealSchemas() {
  const seen = new Set();
  const out = [];
  for (const name of Object.keys(DOMAINS).sort((a, b) => DOMAINS[a].order - DOMAINS[b].order)) {
    const s = DOMAINS[name].realSchema;
    if (s === "public" || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * search_path global. `public` dulu, lalu schema domain, `auth` PALING AKHIR.
 * `auth` sengaja di belakang: ada `auth.users` (auth) DAN `configuration.users`
 * (profil app); referensi bare `users` harus resolve ke `configuration.users`,
 * sedangkan `auth.users` selalu diakses eksplisit. Dipakai runner migrasi & pool
 * app agar referensi tabel "bare" (FK, trigger, function, query-builder) benar.
 */
function searchPathSchemas() {
  return ["public", ...allRealSchemas(), "auth"];
}

/** Schema target untuk satu tabel berdasar nama + schema asalnya. */
function tableTargetSchema(table, sourceSchema) {
  if (sourceSchema === "auth") return "auth";
  return realSchemaForDomain(domainForTable(table, sourceSchema));
}

/**
 * Tulis ulang referensi `<source>.<table>` (quoted & unquoted) ke schema
 * target. `tables` = array { name, source, target }. Hanya menyentuh nama
 * TABEL yang pindah (target != source), sehingga enum/function/view yang tetap
 * di `public` tidak ikut berubah.
 */
function rewriteSchemaRefs(sql, tables) {
  let out = sql;
  for (const { name, source, target } of tables) {
    if (!target || target === source) continue;
    out = out.split(`"${source}"."${name}"`).join(`"${target}"."${name}"`);
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${source}\\.${esc}\\b`, "g"), `${target}.${name}`);
  }
  return out;
}

module.exports = {
  useRealSchemas,
  DOMAINS,
  TABLE_DOMAIN,
  domainForTable,
  folderForDomain,
  schemaForDomain,
  realSchemaForDomain,
  allRealSchemas,
  searchPathSchemas,
  tableTargetSchema,
  rewriteSchemaRefs,
};
