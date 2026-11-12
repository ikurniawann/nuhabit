import type { Page } from "@playwright/test";
import { auditRoute } from "../support/audit";
import { MEMBER_MISSING, MEMBER_STATE, STAFF_MISSING, STAFF_STATE, memberCredentials, staffCredentials } from "../support/auth";
import { DB_MISSING, closeDatabase, firstRow, hasDatabase } from "../support/db";
import { expect, test } from "../support/fixtures";
import { dynamicRoutes } from "../support/routes";

/**
 * Smoke audit for every page with a dynamic segment. Each route has a query
 * that finds a record the page's API accepts (same table and filters as the
 * handler), with one output column per segment. A route whose query finds
 * nothing skips with the table it needed, so a richer seed widens coverage
 * without touching this file.
 */
type Session = "public" | "member" | "staff";
type DetailRoute = { session: Session; sql?: string; skip?: string };

const MEMBER = "(select id from pos.pos_customers where email = 'e2e-member@nuhabit.test')";
const PO = (module: string, extra = "") =>
  `select id from purchasing.purchase_orders where is_active and module_type = '${module}' ${extra} limit 1`;
const PR = (module: string, extra = "") =>
  `select id from purchasing.purchase_requests where module_type = '${module}' ${extra} limit 1`;
const GRN = (module: string, extra = "") =>
  `select g.id from purchasing.grn g join purchasing.purchase_orders po on po.id = g.purchase_order_id where g.is_active and po.module_type = '${module}' ${extra} limit 1`;
const RETURN = (module: string, extra = "") =>
  `select r.id from purchasing.purchase_returns r join purchasing.grn g on g.id = r.grn_id join purchasing.purchase_orders po on po.id = g.purchase_order_id where po.module_type = '${module}' ${extra} limit 1`;
const DELIVERY = (module: string) =>
  `select d.id from purchasing.deliveries d join purchasing.purchase_orders po on po.id = d.purchase_order_id where po.module_type = '${module}' limit 1`;
const ORDER = (context: string) => `select id from manufacturing.production_orders where production_context = '${context}' limit 1`;
const BATCH = (context: string) =>
  `select b.id from manufacturing.production_batches b join manufacturing.production_orders o on o.id = b.production_order_id where o.production_context = '${context}' limit 1`;
const PRODUCT = "select id from item.products where deleted_at is null limit 1";
const RAW_MATERIAL = "select id from item.raw_materials where deleted_at is null limit 1";
const EMPLOYEE = "select id from hris.employees order by created_at limit 1";
const VENUE_SLUG = `select s.booking_slug as slug from ticketing.ticket_settings s
  where s.booking_slug ~ '^[a-z0-9-]{2,50}$' and exists (select 1 from ticketing.ticket_channels c
  where c.branch_id = s.branch_id and c.company_id = s.company_id and c.is_online and c.is_active) limit 1`;
const TRAINING_SLUG = (list: string) => `select trim(both '-' from regexp_replace(lower(trim(coalesce(nullif(e->>'slug', ''), e->>'name'))), '[^a-z0-9]+', '-', 'g')) as slug
  from site.content c, jsonb_array_elements(c.value->'${list}') e where c.key = 'training' limit 1`;
const RESULT = `select id as "resultId" from gym.hyrox_results where customer_id = ${MEMBER} limit 1`;

const ROUTES: Record<string, DetailRoute> = {
  // Public pages
  "/booking/[slug]": { session: "public", sql: VENUE_SLUG },
  "/booking/status/[token]": {
    session: "public",
    sql: "select access_token as token from ticketing.ticket_bookings where access_token ~ '^[0-9a-f]{64}$' limit 1",
  },
  "/interview/[token]": {
    session: "public",
    sql: "select s.token from recruitment.interview_ai_sessions s join recruitment.candidates c on c.id = s.candidate_id where s.token ~* '^[a-f0-9]{48,128}$' limit 1",
  },
  "/offer/[token]": {
    session: "public",
    sql: "select o.token from recruitment.candidate_offers o join recruitment.candidates c on c.id = o.candidate_id where o.token ~* '^[a-f0-9]{48,128}$' limit 1",
  },
  "/pass/[slug]": { session: "public", sql: VENUE_SLUG },
  "/pass/status/[token]": {
    session: "public",
    sql: "select sp.access_token as token from ticketing.ticket_season_passes sp join ticketing.ticket_products tp on tp.id = sp.ticket_product_id where sp.access_token ~ '^[0-9a-f]{64}$' limit 1",
  },
  "/psikotes/[token]": {
    session: "public",
    sql: "select s.token from recruitment.psikotes_sessions s join recruitment.candidates c on c.id = s.candidate_id where s.token ~* '^[a-f0-9]{48,128}$' limit 1",
  },
  "/public/[slug]": {
    session: "public",
    sql: "select slug from crm.crm_forms where is_active and deleted_at is null and slug ~ '^[a-z0-9][a-z0-9-]{1,49}$' order by slug limit 1",
  },
  "/share/[token]": {
    session: "public",
    sql: "select s.token from dataroom.shares s join dataroom.nodes n on n.id = s.node_id where s.revoked_at is null and s.expires_at > now() and n.trashed_at is null and s.token ~ '^[A-Za-z0-9_-]{20,64}$' limit 1",
  },
  "/wholesale/orders/[id]": {
    session: "public",
    skip: "needs a signed-in wholesale partner, and the e2e seed creates no wholesale account",
  },
  "/events/[slug]": { session: "public", sql: "select slug from site.events where status = 'published' limit 1" },
  "/locations/[slug]": { session: "public", sql: "select slug from configuration.branches where is_public and is_active limit 1" },
  "/news/[slug]": {
    session: "public",
    sql: "select slug from site.articles where status = 'published' and published_at <= now() and audience <> 'members' limit 1",
  },
  "/shop/[slug]": { session: "public", sql: "select slug from shop.storefronts where is_active order by is_default desc limit 1" },
  "/shop/order/[token]": { session: "public", sql: "select access_token as token from shop.orders where access_token is not null limit 1" },
  "/training/classes/[slug]": { session: "public", sql: TRAINING_SLUG("class_types") },
  "/training/coaches/[slug]": { session: "public", sql: TRAINING_SLUG("coaches") },
  "/training/stations/[slug]": { session: "public", sql: TRAINING_SLUG("stations") },
  "/table-order/[tableCode]": {
    session: "public",
    sql: `select upper(coalesce(qr_code, table_number)) as "tableCode" from pos.pos_tables where is_active limit 1`,
  },

  // Member app, scoped to the e2e member
  "/member/announcements/[announcementId]": {
    session: "member",
    sql: `select a.id as "announcementId" from crm.member_announcements a where exists (select 1 from crm.member_notifications n where n.announcement_id = a.id and n.customer_id = ${MEMBER}) limit 1`,
  },
  "/member/classes/[sessionId]": {
    session: "member",
    sql: `select id as "sessionId" from gym.class_sessions where status <> 'draft' and starts_at > now() order by starts_at limit 1`,
  },
  "/member/news/[newsId]": {
    session: "member",
    sql: `select a.id as "newsId" from site.articles a where a.status = 'published' and a.published_at <= now() and a.audience <> 'site' and a.branch_ids = '{}' limit 1`,
  },
  "/member/profile/feedback/[id]": { session: "member", sql: `select id from gym.complaints where customer_id = ${MEMBER} limit 1` },
  "/member/promos/[code]": {
    session: "member",
    sql: `select k.code from promo.promo_campaigns c join promo.promo_codes k on k.campaign_id = c.id
      where c.show_in_member_portal and c.is_active and k.is_active
        and (c.valid_from is null or c.valid_from <= (now() at time zone 'Asia/Jakarta')::date)
        and (c.valid_until is null or c.valid_until >= (now() at time zone 'Asia/Jakarta')::date)
        and (k.usage_limit is null or k.usage_count < k.usage_limit) limit 1`,
  },
  "/member/races/[raceId]": { session: "member", sql: `select id as "raceId" from gym.race_events order by starts_at desc limit 1` },
  "/member/races/results/[resultId]": { session: "member", sql: RESULT },
  "/member/races/results/[resultId]/edit": { session: "member", sql: RESULT },
  "/member/train/activities/[activityId]": {
    session: "member",
    sql: `select id as "activityId" from gym.athlete_activities where customer_id = ${MEMBER} or visibility = 'EVERYONE' limit 1`,
  },
  "/member/train/athletes/[memberId]": { session: "member", sql: `select ${MEMBER} as "memberId"` },
  "/member/train/challenges/[challengeId]": {
    session: "member",
    sql: `select id as "challengeId" from gym.athlete_challenges where ends_at >= now() limit 1`,
  },
  "/member/train/segments/[segmentId]": { session: "member", sql: `select id as "segmentId" from gym.athlete_segments limit 1` },
  "/member/trainers/[coachId]": { session: "member", sql: `select id as "coachId" from gym.coaches where status = 'active' limit 1` },
  "/member/wallet/pay/[paymentId]": {
    session: "member",
    sql: `select id as "paymentId" from gym.credit_purchases where customer_id = ${MEMBER} limit 1`,
  },
  "/member/workout/active/[sessionId]": {
    session: "member",
    sql: `select id as "sessionId" from gym.workout_sessions where customer_id = ${MEMBER} limit 1`,
  },
  "/member/workout/preview/[workoutId]": {
    session: "member",
    sql: `select id as "workoutId" from gym.workouts where customer_id = ${MEMBER} limit 1`,
  },

  // Staff dashboard
  "/dashboard/accounting/accounts-payable/po/[id]": { session: "staff", sql: "select id from public.v_purchase_orders limit 1" },
  "/dashboard/accounting/cash-bank/[accountId]": {
    session: "staff",
    // The ledger only opens accounts of the signed-in user's company.
    sql: `select id as "accountId" from accounting.chart_of_accounts where is_cash_bank and deleted_at is null
      and company_id = (select company_id from configuration.users where email = 'e2e-staff@nuhabit.test') limit 1`,
  },
  "/dashboard/accounting/fiscal-years/beginning-balance/[id]": {
    session: "staff",
    sql: "select id from accounting.fiscal_years where deleted_at is null limit 1",
  },
  "/dashboard/accounting/fiscal-years/edit/[id]": { session: "staff", sql: "select id from accounting.fiscal_years where deleted_at is null limit 1" },
  "/dashboard/accounting/journal-entries/edit/[id]": {
    session: "staff",
    sql: `select e.id from accounting.journal_entries e join accounting.fiscal_periods p on p.id = e.fiscal_period_id
      join accounting.fiscal_years y on y.id = p.fiscal_year_id where e.deleted_at is null order by e.created_at desc limit 1`,
  },
  "/dashboard/accounting/journal-mappings/edit/[id]": {
    session: "staff",
    sql: "select id from accounting.journal_mappings where deleted_at is null order by company_id nulls first limit 1",
  },
  "/dashboard/accounting/receivable/invoices-b2b/[id]": {
    session: "staff",
    sql: `select i.id from crm.crm_sales_invoices i join crm.crm_sales_deals d on d.id = i.deal_id
      join crm.crm_sales_leads l on l.id = d.lead_id where i.deleted_at is null limit 1`,
  },
  "/dashboard/crm/members/[id]": { session: "staff", sql: "select id from crm.crm_member_profiles order by created_at limit 1" },
  "/dashboard/employees/[id]": { session: "staff", sql: EMPLOYEE },
  "/dashboard/employees/edit/[id]": { session: "staff", sql: EMPLOYEE },
  "/dashboard/gym/complaints/[id]": {
    session: "staff",
    sql: "select k.id from gym.complaints k join gym.complaint_categories cat on cat.code = k.category limit 1",
  },
  "/dashboard/gym/members/[id]": { session: "staff", sql: "select id from pos.pos_customers order by created_at limit 1" },
  "/dashboard/gym/my-classes/[id]": {
    session: "staff",
    skip: "only opens for the coach who teaches the session, and the e2e staff account is not a coach",
  },
  "/dashboard/gym/sessions/[id]": {
    session: "staff",
    sql: "select s.id from gym.class_sessions s join gym.class_types t on t.id = s.class_type_id order by s.starts_at desc limit 1",
  },
  "/dashboard/hris/candidates/[id]": { session: "staff", sql: "select id from recruitment.candidates limit 1" },
  "/dashboard/hris/live-monitoring/[type]/[id]": {
    session: "staff",
    sql: `select 'psikotes' as type, s.id from recruitment.psikotes_sessions s join recruitment.candidates c on c.id = s.candidate_id
      union all select 'interview', s.id from recruitment.interview_ai_sessions s join recruitment.candidates c on c.id = s.candidate_id limit 1`,
  },
  "/dashboard/hris/offboarding/[employee_id]": { session: "staff", sql: `select id as employee_id from (${EMPLOYEE}) e` },
  "/dashboard/hris/onboarding/[employee_id]": { session: "staff", sql: `select id as employee_id from (${EMPLOYEE}) e` },
  "/dashboard/hris/payroll/[id]": { session: "staff", sql: "select id from hris.payroll_runs order by created_at desc limit 1" },
  "/dashboard/hris/payroll/[id]/payslip/[employeeId]": {
    session: "staff",
    sql: `select payroll_run_id as id, employee_id as "employeeId" from hris.payroll_details order by created_at desc limit 1`,
  },
  "/dashboard/hris/salary/[id]": { session: "staff", sql: "select id from hris.employee_salary limit 1" },
  "/dashboard/inventory/[id]": { session: "staff", sql: "select id from public.v_inventory order by material_nama limit 1" },
  "/dashboard/inventory/adjustment/[id]": { session: "staff", sql: "select id from inventory.stock_opnames limit 1" },
  "/dashboard/inventory/opname/[id]": { session: "staff", sql: "select id from inventory.stock_opnames limit 1" },
  "/dashboard/sales-funnel/accounts/[id]": { session: "staff", sql: "select id from crm.crm_accounts where deleted_at is null limit 1" },
  "/dashboard/sales-funnel/leads/[id]": { session: "staff", sql: "select id from crm.crm_sales_leads where deleted_at is null limit 1" },
  "/dashboard/sales-funnel/pipeline/quotations/[id]": {
    session: "staff",
    sql: `select q.id from crm.crm_sales_quotations q join crm.crm_sales_deals d on d.id = q.deal_id
      where q.deleted_at is null and d.deleted_at is null limit 1`,
  },
  "/dashboard/ticketing/tickets/[id]": {
    session: "staff",
    sql: `select tp.id from ticketing.ticket_products tp
      where tp.company_id::text = (select value #>> '{}' from crm.crm_settings where key = 'default_company_id')
        and tp.branch_id::text = (select value #>> '{}' from crm.crm_settings where key = 'default_branch_id') limit 1`,
  },

  // Items and purchasing
  "/dashboard/items/general/inventory/[id]": {
    session: "staff",
    sql: "select si.id from inventory.supply_inventory si join item.supply_items s on s.id = si.supply_item_id limit 1",
  },
  "/dashboard/items/general/purchasing/po/[id]": { session: "staff", sql: PO("general") },
  "/dashboard/items/general/purchasing/pr/[id]": { session: "staff", sql: PR("general") },
  "/dashboard/items/general/purchasing/pr/edit/[id]": { session: "staff", sql: PR("general", "and status = 'draft'") },
  "/dashboard/items/general/purchasing/receive/[poId]": {
    session: "staff",
    sql: `select id as "poId" from (${PO("general", "and status in ('approved', 'sent', 'partially_received', 'partial')")}) po`,
  },
  "/dashboard/items/product/[...path]": { session: "staff", sql: "select 'inventory/transfer' as path" },
  "/dashboard/items/product/inventory/opname/[id]": { session: "staff", sql: "select id from inventory.product_stock_opnames limit 1" },
  "/dashboard/items/product/production/batches/[id]": { session: "staff", sql: BATCH("product") },
  "/dashboard/items/product/production/orders/[id]": { session: "staff", sql: ORDER("product") },
  "/dashboard/items/product/purchasing/delivery/[id]": { session: "staff", sql: DELIVERY("product") },
  "/dashboard/items/product/purchasing/invoice/po/[id]": { session: "staff", sql: PO("product") },
  "/dashboard/items/product/purchasing/po/[id]": { session: "staff", sql: PO("product") },
  "/dashboard/items/product/purchasing/pr/[id]": { session: "staff", sql: PR("product") },
  "/dashboard/items/product/purchasing/pr/edit/[id]": { session: "staff", sql: PR("product", "and status = 'draft'") },
  "/dashboard/items/product/purchasing/price-list/[id]": { session: "staff", sql: "select id from purchasing.vendor_price_lists limit 1" },
  "/dashboard/items/product/purchasing/price-list/edit/[id]": { session: "staff", sql: "select id from purchasing.vendor_price_lists limit 1" },
  "/dashboard/items/product/purchasing/receive/[id]": { session: "staff", sql: GRN("product") },
  "/dashboard/items/product/purchasing/receive/[id]/qc": { session: "staff", sql: GRN("product") },
  "/dashboard/items/product/purchasing/receive/continue/[id]": { session: "staff", sql: GRN("product", "and g.status = 'pending'") },
  "/dashboard/items/product/purchasing/returns/[id]": { session: "staff", sql: RETURN("product") },
  "/dashboard/items/product/purchasing/returns/edit/[id]": {
    session: "staff",
    sql: RETURN("product", "and r.status in ('draft', 'pending_approval')"),
  },
  "/dashboard/items/product/purchasing/vendor/[id]": { session: "staff", sql: "select id from purchasing.vendors limit 1" },
  "/dashboard/items/product/purchasing/vendor/edit/[id]": { session: "staff", sql: "select id from purchasing.vendors limit 1" },
  "/dashboard/items/products/[id]": { session: "staff", sql: PRODUCT },
  "/dashboard/items/products/bom/[id]": { session: "staff", sql: PRODUCT },
  "/dashboard/items/products/edit/[id]": { session: "staff", sql: PRODUCT },
  "/dashboard/items/raw-material/materials/bom/[id]": { session: "staff", sql: RAW_MATERIAL },
  "/dashboard/items/raw-material/production/batches/[id]": { session: "staff", sql: BATCH("raw_material") },
  "/dashboard/items/raw-material/production/orders/[id]": { session: "staff", sql: ORDER("raw_material") },
  "/dashboard/items/raw-materials/[id]": { session: "staff", sql: RAW_MATERIAL },
  "/dashboard/items/raw-materials/edit/[id]": { session: "staff", sql: RAW_MATERIAL },
  "/dashboard/purchasing/delivery/[id]": { session: "staff", sql: DELIVERY("raw_material") },
  "/dashboard/purchasing/grn/[id]": { session: "staff", sql: GRN("raw_material") },
  "/dashboard/purchasing/grn/[id]/qc": { session: "staff", sql: GRN("raw_material") },
  "/dashboard/purchasing/grn/continue/[id]": { session: "staff", sql: GRN("raw_material", "and g.status = 'pending'") },
  "/dashboard/purchasing/invoice/po/[id]": { session: "staff", sql: PO("raw_material") },
  "/dashboard/purchasing/po/[id]": { session: "staff", sql: PO("raw_material") },
  "/dashboard/purchasing/po/[id]/receive": { session: "staff", sql: PO("raw_material") },
  "/dashboard/purchasing/po/edit/[id]": { session: "staff", sql: PO("raw_material", "and status = 'draft'") },
  "/dashboard/purchasing/pr/[id]": { session: "staff", sql: PR("raw_material") },
  "/dashboard/purchasing/pr/edit/[id]": { session: "staff", sql: PR("raw_material", "and status = 'draft'") },
  "/dashboard/purchasing/print/po/[id]": { session: "staff", sql: PO("raw_material") },
  "/dashboard/purchasing/print/pr/[id]": { session: "staff", sql: PR("raw_material") },
  "/dashboard/purchasing/production/orders/[id]": { session: "staff", sql: ORDER("raw_material") },
  "/dashboard/purchasing/products/[id]": { session: "staff", sql: PRODUCT },
  "/dashboard/purchasing/products/[id]/bom": { session: "staff", sql: PRODUCT },
  "/dashboard/purchasing/products/edit/[id]": { session: "staff", sql: PRODUCT },
  "/dashboard/purchasing/qc/[id]": { session: "staff", sql: "select id from purchasing.grn_qc_inspections limit 1" },
  "/dashboard/purchasing/raw-materials/[id]": { session: "staff", sql: RAW_MATERIAL },
  "/dashboard/purchasing/raw-materials/edit/[id]": { session: "staff", sql: RAW_MATERIAL },
  "/dashboard/purchasing/returns/[id]": { session: "staff", sql: RETURN("raw_material") },
  "/dashboard/purchasing/returns/edit/[id]": { session: "staff", sql: RETURN("raw_material", "and r.status in ('draft', 'pending_approval')") },
  "/dashboard/purchasing/suppliers/[id]": { session: "staff", sql: "select id from purchasing.suppliers where deleted_at is null limit 1" },
  "/dashboard/purchasing/suppliers/edit/[id]": { session: "staff", sql: "select id from purchasing.suppliers where deleted_at is null limit 1" },
};

const SESSION = {
  public: { state: undefined, missing: null, signIn: undefined },
  member: { state: MEMBER_STATE, missing: memberCredentials() ? null : MEMBER_MISSING, signIn: /\/member\/auth\/login/ },
  staff: { state: STAFF_STATE, missing: staffCredentials() ? null : STAFF_MISSING, signIn: /\/login/ },
} as const;

/** Fills each [segment] or [...segment] of the pattern from the row column of the same name. */
function fill(pattern: string, row: Record<string, unknown>): string {
  return pattern.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, (_, name: string) => {
    const value = row[name];
    if (value === null || value === undefined) throw new Error(`query for ${pattern} returned no "${name}" column`);
    return name === "path" ? String(value) : encodeURIComponent(String(value));
  });
}

/** API calls that answer 404 or 5xx while the page loads mean the record or its data did not load. */
function watchApiFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    const status = response.status();
    if (url.pathname.startsWith("/api/") && (status === 404 || status >= 500)) {
      failures.push(`${status} ${response.request().method()} ${url.pathname}`);
    }
  });
  return failures;
}

test.describe("detail pages", () => {
  test.skip(!hasDatabase(), DB_MISSING);
  test.afterAll(closeDatabase);

  test("every dynamic route has an entry", () => {
    expect(dynamicRoutes().filter((route) => !(route in ROUTES)), "add these routes to ROUTES").toEqual([]);
  });

  for (const [pattern, route] of Object.entries(ROUTES)) {
    const session = SESSION[route.session];
    test.describe(() => {
      if (session.state) test.use({ storageState: session.state });
      test(pattern, async ({ page }) => {
        test.skip(Boolean(route.skip), route.skip);
        test.skip(Boolean(session.missing), session.missing ?? "");
        const row = await firstRow(route.sql!);
        test.skip(!row, `no record in this database for: ${route.sql}`);
        const url = fill(pattern, row!);
        test.info().annotations.push({ type: "url", description: url });
        const apiFailures = watchApiFailures(page);
        await auditRoute(page, url, session.signIn, pattern);
        expect.soft(apiFailures, "API calls failed while the page loaded").toEqual([]);
      });
    });
  }
});
