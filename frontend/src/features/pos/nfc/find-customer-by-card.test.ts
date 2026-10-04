import { describe, expect, it } from "vitest";
import { findCustomerByCard } from "./find-customer-by-card";

describe("findCustomerByCard", () => {
  const customers = [
    { id: "uuid-1", phone: "08123456789", name: "Ada", nfc_uid: "D3C31CD3" },
    { id: "uuid-2", phone: "089999", name: "Bob" },
  ];

  it("matches by customer id", () => {
    expect(findCustomerByCard(customers, "uuid-1")?.name).toBe("Ada");
  });

  it("matches by phone", () => {
    expect(findCustomerByCard(customers, "089999")?.name).toBe("Bob");
  });

  it("matches by nfc_uid case-insensitively", () => {
    expect(findCustomerByCard(customers, "d3c31cd3")?.name).toBe("Ada");
  });

  it("trims input before matching", () => {
    expect(findCustomerByCard(customers, "  uuid-2  ")?.name).toBe("Bob");
  });

  it("returns null when not found", () => {
    expect(findCustomerByCard(customers, "missing")).toBeNull();
  });
});
