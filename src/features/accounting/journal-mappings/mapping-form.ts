import type { JournalMappingItem, JournalMappingLinePayload } from "@/lib/accounting/types";
import type { JournalAmountSource, JournalEntrySide, JournalModule } from "@/lib/accounting/journal-mapping-types";

/** State & aturan murni form journal mapping (diuji unit). */

export type MappingFormLine = {
  key: string;
  entry_side: JournalEntrySide;
  line_role: string;
  account_id: string;
  amount_source: JournalAmountSource;
  sort_order: number;
  is_required: boolean;
};

export type MappingFormState = {
  event_code: string;
  name: string;
  description: string;
  module: JournalModule | "";
  is_active: boolean;
  lines: MappingFormLine[];
};

let lineSeq = 0;

export function newMappingLine(partial?: Partial<MappingFormLine>): MappingFormLine {
  lineSeq += 1;
  return {
    key: `tmp-${lineSeq}`,
    entry_side: "DEBIT",
    line_role: "OTHER",
    account_id: "",
    amount_source: "TOTAL",
    sort_order: 10,
    is_required: true,
    ...partial,
  };
}

/** Form baru: contoh penjualan tunai (Debit Kas TOTAL, Credit Revenue SUBTOTAL). */
export function createMappingForm(): MappingFormState {
  return {
    event_code: "",
    name: "",
    description: "",
    module: "",
    is_active: true,
    lines: [
      newMappingLine({ entry_side: "DEBIT", line_role: "CASH", sort_order: 10 }),
      newMappingLine({ entry_side: "CREDIT", line_role: "REVENUE", amount_source: "SUBTOTAL", sort_order: 20 }),
    ],
  };
}

export function mappingFormFromItem(item: JournalMappingItem): MappingFormState {
  return {
    event_code: item.event_code,
    name: item.name,
    description: item.description ?? "",
    module: item.module,
    is_active: item.is_active,
    lines: item.lines.map((l, idx) => ({
      key: l.id,
      entry_side: l.entry_side,
      line_role: l.line_role,
      account_id: l.account_id ?? "",
      amount_source: l.amount_source,
      sort_order: l.sort_order ?? (idx + 1) * 10,
      is_required: l.is_required,
    })),
  };
}

/** Payload simpan, atau pesan galat bila field wajib belum lengkap. */
export function mappingPayload(form: MappingFormState) {
  if (!form.event_code || !form.name.trim() || !form.module) {
    return { error: "Event, nama, dan module wajib diisi" } as const;
  }
  if (form.lines.length < 1) return { error: "Minimal satu baris mapping" } as const;
  const lines: JournalMappingLinePayload[] = form.lines.map((l, idx) => ({
    entry_side: l.entry_side,
    line_role: l.line_role,
    account_id: l.account_id || null,
    amount_source: l.amount_source,
    sort_order: l.sort_order || (idx + 1) * 10,
    is_required: l.is_required,
  }));
  return {
    payload: {
      event_code: form.event_code,
      name: form.name.trim(),
      description: form.description.trim() || null,
      module: form.module,
      is_active: form.is_active,
      lines,
    },
  } as const;
}
