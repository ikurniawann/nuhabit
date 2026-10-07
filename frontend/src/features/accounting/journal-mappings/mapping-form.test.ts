import { describe, expect, it } from "vitest";
import { createMappingForm, mappingPayload } from "./mapping-form";

describe("mappingPayload", () => {
  it("wajib event, nama, module, dan minimal satu baris", () => {
    expect(mappingPayload(createMappingForm())).toEqual({ error: "Event, nama, dan module wajib diisi" });
    const filled = { ...createMappingForm(), event_code: "POS_SALE", name: " Jual ", module: "POS" as const };
    expect(mappingPayload({ ...filled, lines: [] })).toEqual({ error: "Minimal satu baris mapping" });
  });

  it("akun kosong jadi null dan nama di-trim", () => {
    const form = { ...createMappingForm(), event_code: "POS_SALE", name: " Jual ", module: "POS" as const };
    const result = mappingPayload(form);
    expect("payload" in result && result.payload).toMatchObject({
      name: "Jual",
      description: null,
      lines: [
        { entry_side: "DEBIT", line_role: "CASH", account_id: null, amount_source: "TOTAL", sort_order: 10 },
        { entry_side: "CREDIT", line_role: "REVENUE", account_id: null, amount_source: "SUBTOTAL", sort_order: 20 },
      ],
    });
  });
});
