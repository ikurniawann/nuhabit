import { query, queryOne } from "@/lib/db";
import { sortWarehouses } from "@/lib/configuration/sort-warehouses";

export type BusinessEntityType = "holding" | "company" | "branch" | "warehouse";

export interface BusinessWarehouseRow {
  id: string;
  branch_id: string;
  name: string;
  code: string;
  is_default: boolean;
  is_active: boolean;
}

export interface BusinessBranchRow {
  id: string;
  company_id: string;
  name: string;
  code: string;
  is_active: boolean;
  warehouses: BusinessWarehouseRow[];
}

export interface BusinessCompanyRow {
  id: string;
  holding_id: string;
  name: string;
  code: string;
  is_active: boolean;
  branches: BusinessBranchRow[];
}

export interface BusinessHoldingRow {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  companies: BusinessCompanyRow[];
}

export interface BusinessTree {
  holdings: BusinessHoldingRow[];
}

function slugCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

async function nextWarehouseCode(branchId: string): Promise<{ name: string; code: string }> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM configuration.warehouses WHERE branch_id = $1`,
    [branchId]
  );
  const n = Number(row?.count ?? 0) + 1;
  return { name: `Stall ${n}`, code: `STALL-${String(n).padStart(2, "0")}` };
}

export async function fetchBusinessTree(): Promise<BusinessTree> {
  const holdings = await query<{
    id: string;
    name: string;
    code: string;
    is_active: boolean;
  }>(`SELECT id, name, code, is_active FROM configuration.holdings ORDER BY name`);

  const companies = await query<{
    id: string;
    holding_id: string;
    name: string;
    code: string;
    is_active: boolean;
  }>(`SELECT id, holding_id, name, code, is_active FROM configuration.companies ORDER BY name`);

  const branches = await query<{
    id: string;
    company_id: string;
    name: string;
    code: string;
    is_active: boolean;
  }>(`SELECT id, company_id, name, code, is_active FROM configuration.branches ORDER BY name`);

  const warehouses = await query<BusinessWarehouseRow>(
    `SELECT id, branch_id, name, code, is_default, is_active
     FROM configuration.warehouses
     WHERE is_active = true
     ORDER BY is_default DESC, code`
  );

  const warehousesByBranch = new Map<string, BusinessWarehouseRow[]>();
  for (const wh of warehouses) {
    const list = warehousesByBranch.get(wh.branch_id) ?? [];
    list.push(wh);
    warehousesByBranch.set(wh.branch_id, list);
  }
  for (const [branchId, list] of warehousesByBranch) {
    warehousesByBranch.set(branchId, sortWarehouses(list));
  }

  const branchesByCompany = new Map<string, BusinessBranchRow[]>();
  for (const br of branches) {
    const list = branchesByCompany.get(br.company_id) ?? [];
    list.push({ ...br, warehouses: warehousesByBranch.get(br.id) ?? [] });
    branchesByCompany.set(br.company_id, list);
  }

  const companiesByHolding = new Map<string, BusinessCompanyRow[]>();
  for (const co of companies) {
    const list = companiesByHolding.get(co.holding_id) ?? [];
    list.push({ ...co, branches: branchesByCompany.get(co.id) ?? [] });
    companiesByHolding.set(co.holding_id, list);
  }

  return {
    holdings: holdings.map((h) => ({
      ...h,
      companies: companiesByHolding.get(h.id) ?? [],
    })),
  };
}

export async function createBusinessEntity(
  type: BusinessEntityType,
  payload: {
    name: string;
    code?: string;
    parentId?: string;
    is_active?: boolean;
  }
) {
  const name = payload.name.trim();
  if (!name) throw new Error("Nama wajib diisi");

  const isActive = payload.is_active ?? true;

  if (type === "holding") {
    const code = (payload.code ?? slugCode(name)).toUpperCase();
    const row = await queryOne<{ id: string }>(
      `INSERT INTO configuration.holdings (name, code, is_active)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [name, code, isActive]
    );
    return { id: row!.id, type };
  }

  if (type === "company") {
    if (!payload.parentId) throw new Error("Holding wajib dipilih");
    const code = (payload.code ?? slugCode(name)).toUpperCase();
    const row = await queryOne<{ id: string }>(
      `INSERT INTO configuration.companies (holding_id, name, code, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [payload.parentId, name, code, isActive]
    );
    return { id: row!.id, type };
  }

  if (type === "branch") {
    if (!payload.parentId) throw new Error("Company wajib dipilih");
    const code = (payload.code ?? slugCode(name)).toUpperCase();
    const row = await queryOne<{ id: string }>(
      `INSERT INTO configuration.branches (company_id, name, code, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [payload.parentId, name, code, isActive]
    );
    return { id: row!.id, type };
  }

  if (type === "warehouse") {
    if (!payload.parentId) throw new Error("Branch wajib dipilih");
    const auto = await nextWarehouseCode(payload.parentId);
    const whName = name || auto.name;
    const code = (payload.code ?? auto.code).toUpperCase();
    const row = await queryOne<{ id: string }>(
      `INSERT INTO configuration.warehouses (branch_id, name, code, is_default, is_active)
       VALUES ($1, $2, $3, false, $4)
       RETURNING id`,
      [payload.parentId, whName, code, isActive]
    );
    return { id: row!.id, type };
  }

  throw new Error("Tipe entitas tidak valid");
}

export async function updateBusinessEntity(
  type: BusinessEntityType,
  id: string,
  payload: { name?: string; code?: string; is_active?: boolean }
) {
  const tableMap = {
    holding: "holdings",
    company: "companies",
    branch: "branches",
    warehouse: "warehouses",
  } as const;

  const table = tableMap[type];
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (payload.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(payload.name.trim());
  }
  if (payload.code !== undefined) {
    sets.push(`code = $${idx++}`);
    values.push(payload.code.trim().toUpperCase());
  }
  if (payload.is_active !== undefined) {
    sets.push(`is_active = $${idx++}`);
    values.push(payload.is_active);
  }

  if (sets.length === 0) throw new Error("Tidak ada data yang diperbarui");

  sets.push(`updated_at = now()`);
  values.push(id);

  await queryOne(
    `UPDATE configuration.${table} SET ${sets.join(", ")} WHERE id = $${idx} RETURNING id`,
    values
  );
}

export async function deleteBusinessEntity(type: BusinessEntityType, id: string) {
  if (type === "warehouse") {
    const wh = await queryOne<{ is_default: boolean; branch_id: string }>(
      `SELECT is_default, branch_id FROM configuration.warehouses WHERE id = $1`,
      [id]
    );
    if (!wh) throw new Error("Stall tidak ditemukan");
    if (wh.is_default) {
      const count = await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM configuration.warehouses WHERE branch_id = $1`,
        [wh.branch_id]
      );
      if (Number(count?.count ?? 0) <= 1) {
        throw new Error("Main Storage tidak dapat dihapus. Setiap cabang wajib memiliki minimal 1 stall.");
      }
    }
  }

  const tableMap = {
    holding: "holdings",
    company: "companies",
    branch: "branches",
    warehouse: "warehouses",
  } as const;

  await queryOne(`DELETE FROM configuration.${tableMap[type]} WHERE id = $1 RETURNING id`, [id]);
}
