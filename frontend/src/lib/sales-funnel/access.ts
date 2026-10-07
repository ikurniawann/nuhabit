import { ApiError } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { queryOne } from "@/lib/db";
import { hasCompanyScope, type SalesFunnelUser } from "./server";

export type AccessibleLead = {
  id: string;
  company_id: string;
  branch_id: string;
  owner_user_id: string | null;
};

export type AccessibleDeal = AccessibleLead & {
  lead_id: string;
  stage_id: string;
  event_date: string | null;
  value_final: string | null;
};

type AccessResult<T> = { record: T | null; forbidden: boolean };

/**
 * Cek scope bisnis + kepemilikan sales atas satu baris lead/deal — pola
 * findAccessibleLead Fase A yang dipakai bersama semua route (leads, deals,
 * activities, kirim WA). Fail-closed: non-super_admin tanpa company scope
 * langsung forbidden.
 */
async function checkRowAccess<T extends AccessibleLead>(
  row: T | null,
  user: SalesFunnelUser
): Promise<AccessResult<T>> {
  const scope = await getApiUserScope();
  if (!hasCompanyScope(user, scope)) {
    return { record: null, forbidden: true };
  }
  if (!row) return { record: null, forbidden: false };

  if (scope?.companyId && row.company_id !== scope.companyId) {
    return { record: null, forbidden: true };
  }
  if (
    scope?.businessScope === "branch" &&
    scope.branchId &&
    row.branch_id !== scope.branchId
  ) {
    return { record: null, forbidden: true };
  }
  if (
    user.role === "sales" &&
    row.owner_user_id !== null &&
    row.owner_user_id !== user.id
  ) {
    return { record: null, forbidden: true };
  }
  return { record: row, forbidden: false };
}

export async function findAccessibleLead(
  id: string,
  user: SalesFunnelUser
): Promise<{ lead: AccessibleLead | null; forbidden: boolean }> {
  const row = await queryOne<AccessibleLead>(
    `SELECT id, company_id, branch_id, owner_user_id
     FROM crm.crm_sales_leads WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const { record, forbidden } = await checkRowAccess(row, user);
  return { lead: record, forbidden };
}

export async function findAccessibleDeal(
  id: string,
  user: SalesFunnelUser
): Promise<{ deal: AccessibleDeal | null; forbidden: boolean }> {
  const row = await queryOne<AccessibleDeal>(
    `SELECT id, company_id, branch_id, owner_user_id, lead_id, stage_id,
            event_date, value_final
     FROM crm.crm_sales_deals WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const { record, forbidden } = await checkRowAccess(row, user);
  return { deal: record, forbidden };
}

export async function findAccessibleActivity(
  id: string,
  user: SalesFunnelUser
): Promise<{ activity: AccessibleLead | null; forbidden: boolean }> {
  const row = await queryOne<AccessibleLead>(
    `SELECT id, company_id, branch_id, owner_user_id
     FROM crm.crm_sales_activities WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const { record, forbidden } = await checkRowAccess(row, user);
  return { activity: record, forbidden };
}

// ── EPIC-050 Fase 1: Account, Contact, subjek task polimorfik ──

export async function findAccessibleAccount(
  id: string,
  user: SalesFunnelUser
): Promise<{ account: AccessibleLead | null; forbidden: boolean }> {
  const row = await queryOne<AccessibleLead>(
    `SELECT id, company_id, branch_id, owner_user_id
     FROM crm.crm_accounts WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const { record, forbidden } = await checkRowAccess(row, user);
  return { account: record, forbidden };
}

export async function findAccessibleContact(
  id: string,
  user: SalesFunnelUser
): Promise<{ contact: AccessibleLead | null; forbidden: boolean }> {
  const row = await queryOne<AccessibleLead>(
    `SELECT id, company_id, branch_id, owner_user_id
     FROM crm.crm_contacts WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const { record, forbidden } = await checkRowAccess(row, user);
  return { contact: record, forbidden };
}

export type TaskSubjectVenue = {
  company_id: string;
  branch_id: string;
  owner_user_id: string | null;
};

/**
 * Venue (company/branch) yang diwarisi task dari subjeknya + cek akses.
 * Member (pos_customers) global by design → venue diambil dari scope user /
 * venue default (dipakai route untuk resolveSalesVenue).
 */
export async function findAccessibleSubject(
  subjectType: "lead" | "deal" | "account" | "contact" | "member",
  subjectId: string,
  user: SalesFunnelUser
): Promise<{ venue: TaskSubjectVenue | null; forbidden: boolean; notFound: boolean; memberGlobal: boolean }> {
  const notFound = { venue: null, forbidden: false, notFound: true, memberGlobal: false };
  switch (subjectType) {
    case "deal": {
      const { deal, forbidden } = await findAccessibleDeal(subjectId, user);
      if (forbidden) return { ...notFound, forbidden: true, notFound: false };
      return deal ? { venue: deal, forbidden: false, notFound: false, memberGlobal: false } : notFound;
    }
    case "lead": {
      const { lead, forbidden } = await findAccessibleLead(subjectId, user);
      if (forbidden) return { ...notFound, forbidden: true, notFound: false };
      return lead ? { venue: lead, forbidden: false, notFound: false, memberGlobal: false } : notFound;
    }
    case "account": {
      const { account, forbidden } = await findAccessibleAccount(subjectId, user);
      if (forbidden) return { ...notFound, forbidden: true, notFound: false };
      return account ? { venue: account, forbidden: false, notFound: false, memberGlobal: false } : notFound;
    }
    case "contact": {
      const { contact, forbidden } = await findAccessibleContact(subjectId, user);
      if (forbidden) return { ...notFound, forbidden: true, notFound: false };
      return contact ? { venue: contact, forbidden: false, notFound: false, memberGlobal: false } : notFound;
    }
    case "member": {
      const member = await queryOne<{ id: string }>(
        `SELECT id FROM pos.pos_customers WHERE id = $1`,
        [subjectId]
      );
      if (!member) return notFound;
      return { venue: null, forbidden: false, notFound: false, memberGlobal: true };
    }
  }
}

// ── Versi lempar ApiError (route lewat apiHandler): 403 bila di luar scope,
// 404 bila tidak ada ──

function assertAccessible<T>(record: T | null, forbidden: boolean, notFoundMessage: string): T {
  if (forbidden) throw ApiError.forbidden();
  if (!record) throw ApiError.notFound(notFoundMessage);
  return record;
}

export async function requireAccessibleLead(id: string, user: SalesFunnelUser): Promise<AccessibleLead> {
  const { lead, forbidden } = await findAccessibleLead(id, user);
  return assertAccessible(lead, forbidden, "Lead tidak ditemukan");
}

export async function requireAccessibleDeal(id: string, user: SalesFunnelUser): Promise<AccessibleDeal> {
  const { deal, forbidden } = await findAccessibleDeal(id, user);
  return assertAccessible(deal, forbidden, "Deal tidak ditemukan");
}

export async function requireAccessibleActivity(id: string, user: SalesFunnelUser): Promise<AccessibleLead> {
  const { activity, forbidden } = await findAccessibleActivity(id, user);
  return assertAccessible(activity, forbidden, "Aktivitas tidak ditemukan");
}

export async function requireAccessibleAccount(id: string, user: SalesFunnelUser): Promise<AccessibleLead> {
  const { account, forbidden } = await findAccessibleAccount(id, user);
  return assertAccessible(account, forbidden, "Account tidak ditemukan");
}

export async function requireAccessibleContact(id: string, user: SalesFunnelUser): Promise<AccessibleLead> {
  const { contact, forbidden } = await findAccessibleContact(id, user);
  return assertAccessible(contact, forbidden, "Contact tidak ditemukan");
}

export async function requireAccessibleSubject(
  subjectType: Parameters<typeof findAccessibleSubject>[0],
  subjectId: string,
  user: SalesFunnelUser
): Promise<{ venue: TaskSubjectVenue | null; memberGlobal: boolean }> {
  const { venue, forbidden, notFound, memberGlobal } = await findAccessibleSubject(subjectType, subjectId, user);
  if (forbidden) throw ApiError.forbidden();
  if (notFound) throw ApiError.notFound("Subjek tidak ditemukan");
  return { venue, memberGlobal };
}

/**
 * Dokumen anak deal (quotation/invoice): baris dicek dengan fetch minimal
 * dulu (jangan materialisasi PII tenant lain sebelum otorisasi), lalu akses
 * mengikuti deal induk. Deal tak terjangkau = 403.
 */
export async function requireDealChildAccess<T extends { deal_id: string }>(
  row: T | null,
  user: SalesFunnelUser,
  notFoundMessage: string
): Promise<{ row: T; deal: AccessibleDeal }> {
  if (!row) throw ApiError.notFound(notFoundMessage);
  const { deal, forbidden } = await findAccessibleDeal(row.deal_id, user);
  if (forbidden || !deal) throw ApiError.forbidden();
  return { row, deal };
}
