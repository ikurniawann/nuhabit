import type { CashFlowCategory } from "@/lib/accounting/coa-types";
import type { CoaAccountItem, CoaAccountPayload } from "./types";

/** State form tambah/edit akun COA + aturan murninya (diuji unit). */

export type CoaForm = {
  code: string;
  name: string;
  parent_id: string;
  account_type_id: string;
  is_contra: boolean;
  is_cash_bank: boolean;
  cash_flow_category: string;
  description: string;
  is_active: boolean;
};

export const EMPTY_COA_FORM: CoaForm = {
  code: "",
  name: "",
  parent_id: "",
  account_type_id: "",
  is_contra: false,
  is_cash_bank: false,
  cash_flow_category: "",
  description: "",
  is_active: true,
};

export function formFromAccount(item: CoaAccountItem): CoaForm {
  return {
    code: item.code_display || item.code,
    name: item.name,
    parent_id: item.parent_id ?? "",
    account_type_id: item.account_type_id,
    is_contra: item.is_contra,
    is_cash_bank: item.is_cash_bank,
    cash_flow_category: item.cash_flow_category ?? "",
    description: item.description ?? "",
    is_active: item.is_active,
  };
}

/** Akun baru di bawah `parent` mewarisi account type parent, atau type pertama. */
export function formForNewChild(parent: CoaAccountItem | null, defaultTypeId: string): CoaForm {
  return { ...EMPTY_COA_FORM, parent_id: parent?.id ?? "", account_type_id: parent?.account_type_id || defaultTypeId };
}

export function coaPayload(form: CoaForm): CoaAccountPayload {
  return {
    code: form.code,
    name: form.name,
    parent_id: form.parent_id || null,
    account_type_id: form.account_type_id,
    is_contra: form.is_contra,
    is_cash_bank: form.is_cash_bank,
    cash_flow_category: (form.cash_flow_category || null) as CashFlowCategory | null,
    description: form.description || null,
    is_active: form.is_active,
  };
}

export function isCoaFormComplete(form: CoaForm) {
  return Boolean(form.code.trim() && form.name.trim() && form.account_type_id);
}

/** Company acuan form: akun yang diedit, parent terpilih, atau company COA yang tampil. */
export function resolveFormCompanyId(
  editing: CoaAccountItem | null,
  parentId: string,
  allRows: CoaAccountItem[]
): string | null {
  if (editing) return editing.company_id ?? null;
  const parent = parentId ? allRows.find((r) => r.id === parentId) : undefined;
  if (parent) return parent.company_id ?? null;
  return allRows.find((r) => r.company_id)?.company_id ?? null;
}

/**
 * Kandidat parent: satu company, bukan leaf level 4, dan bukan akun itu
 * sendiri atau turunannya (mencegah siklus).
 */
export function parentCandidates(allRows: CoaAccountItem[], editingId: string | null, companyId: string | null) {
  const excluded = new Set<string>();
  if (editingId) {
    excluded.add(editingId);
    const queue = [editingId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const row of allRows) {
        if (row.parent_id === id && !excluded.has(row.id)) {
          excluded.add(row.id);
          queue.push(row.id);
        }
      }
    }
  }
  return allRows.filter((p) => !excluded.has(p.id) && (p.company_id ?? null) === companyId && p.level < 4);
}
