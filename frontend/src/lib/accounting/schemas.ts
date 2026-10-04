import { z } from "zod";
import { CASH_FLOW_CATEGORIES } from "./coa-types";
import { FISCAL_PERIOD_STATUSES, JOURNAL_LINE_SIDES } from "./fiscal-types";
import {
  JOURNAL_AMOUNT_SOURCES,
  JOURNAL_ENTRY_SIDES,
  JOURNAL_MODULES,
} from "./journal-mapping-types";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const journalEntryPayloadSchema = z.object({
  entry_date: dateOnly,
  description: z.string().trim().nullable().optional(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        account_id: z.string().uuid(),
        entry_side: z.enum([...JOURNAL_LINE_SIDES]),
        amount: z.number().positive(),
        memo: z.string().trim().nullable().optional(),
        sort_order: z.number().int().optional(),
      })
    )
    .min(2),
  post: z.boolean().optional(),
});

export const fiscalYearPayloadSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  start_date: dateOnly,
  end_date: dateOnly,
  is_active: z.boolean().optional(),
  periods: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        period_no: z.number().int().min(1).max(12),
        name: z.string().trim().min(1).max(60),
        start_date: dateOnly,
        end_date: dateOnly,
        status: z.enum([...FISCAL_PERIOD_STATUSES]),
      })
    )
    .min(1)
    .max(12),
});

export const journalMappingPayloadSchema = z.object({
  event_code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().nullable().optional(),
  module: z.enum([...JOURNAL_MODULES]),
  is_active: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        entry_side: z.enum([...JOURNAL_ENTRY_SIDES]),
        line_role: z.string().trim().min(1).max(40),
        account_id: z.string().uuid().nullable().optional(),
        amount_source: z.enum([...JOURNAL_AMOUNT_SOURCES]),
        sort_order: z.number().int().optional(),
        is_required: z.boolean().optional(),
      })
    )
    .min(1),
});

export const beginningBalancePayloadSchema = z.object({
  retained_earnings_account_id: z.string().uuid().nullable().optional(),
  lines: z
    .array(
      z.object({
        account_id: z.string().uuid(),
        entry_side: z.enum([...JOURNAL_LINE_SIDES]),
        amount: z.number().positive(),
        memo: z.string().trim().nullable().optional(),
      })
    )
    .min(2),
  post: z.boolean().optional(),
});

/** Payload fiscal year yang sudah dinormalisasi untuk store. */
export function normalizeFiscalYearPayload(body: z.infer<typeof fiscalYearPayloadSchema>) {
  return {
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    start_date: body.start_date,
    end_date: body.end_date,
    is_active: body.is_active ?? true,
    periods: body.periods,
  };
}

export const chartOfAccountPayloadSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  parent_id: z.string().uuid().nullable().optional(),
  account_type_id: z.string().uuid(),
  is_contra: z.boolean().optional(),
  is_cash_bank: z.boolean().optional(),
  cash_flow_category: z
    .enum([...CASH_FLOW_CATEGORIES])
    .nullable()
    .optional(),
  description: z.string().trim().nullable().optional(),
  is_active: z.boolean().optional(),
});

export type ChartOfAccountPayload = z.infer<typeof chartOfAccountPayloadSchema>;

export const accountTypePayloadSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(100),
  normal_balance: z.enum(["DEBIT", "CREDIT"]),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

export type AccountTypePayload = z.infer<typeof accountTypePayloadSchema>;
