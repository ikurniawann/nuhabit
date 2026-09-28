import { describe, expect, it } from "vitest";
import { orderCustomerLabel, orderCustomerName, orderCustomerPhone } from "./order-customer";

describe("orderCustomerLabel", () => {
  it("member → nama member", () => {
    expect(orderCustomerLabel({ customer: { name: "Riksa", phone: "6281200001111" }, contact_name: "X" })).toBe("Riksa");
    expect(orderCustomerLabel({ customer: { name: "Riksa", phone: "6281200001111" } }, { withPhone: true })).toBe(
      "Riksa · 081200001111"
    );
  });

  it("tamu self-order → nama kontak (bukan Walk-in)", () => {
    const order = { customer: null, contact_name: "Budi", contact_phone: "6281234567890" };
    expect(orderCustomerLabel(order)).toBe("Budi");
    expect(orderCustomerLabel(order, { withPhone: true })).toBe("Budi · 081234567890");
    expect(orderCustomerName(order)).toBe("Budi");
    expect(orderCustomerPhone(order)).toBe("081234567890");
  });

  it("tanpa data → Walk-in", () => {
    expect(orderCustomerLabel({})).toBe("Walk-in");
    expect(orderCustomerLabel(null)).toBe("Walk-in");
  });
});
