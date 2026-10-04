import { describe, expect, test } from "vitest";
import { parseContractListParams } from "./contracts-list";

function params(input: Record<string, string>) {
  return new URLSearchParams(input);
}

describe("parseContractListParams", () => {
  test("default: status active, sort end_date asc, tanpa filter lain", () => {
    const result = parseContractListParams(params({}));
    expect(result).toMatchObject({
      status: "active",
      sortBy: "end_date",
      sortOrder: "asc",
      page: 1,
      limit: 15,
      expiringWithin: null,
      contractType: null,
      search: null,
    });
  });

  test("membaca filter valid", () => {
    const result = parseContractListParams(
      params({
        days: "30",
        type: "pkwt",
        status: "ended",
        search: " budi ",
        sort_by: "employee_name",
        sort_order: "desc",
        page: "2",
        limit: "50",
      })
    );
    expect(result).toMatchObject({
      expiringWithin: 30,
      contractType: "pkwt",
      status: "ended",
      search: "budi",
      sortBy: "employee_name",
      sortOrder: "desc",
      page: 2,
      limit: 50,
    });
  });

  test("menolak sort_by di luar whitelist (fallback default)", () => {
    const result = parseContractListParams(params({ sort_by: "base_salary; DROP TABLE" }));
    expect(result.sortBy).toBe("end_date");
  });

  test("status 'all' berarti tanpa filter status", () => {
    expect(parseContractListParams(params({ status: "all" })).status).toBeNull();
  });

  test("clamp days ke 1-365 dan page/limit positif", () => {
    expect(parseContractListParams(params({ days: "9999" })).expiringWithin).toBe(365);
    expect(parseContractListParams(params({ days: "-3" })).expiringWithin).toBe(1);
    expect(parseContractListParams(params({ page: "0", limit: "1000" }))).toMatchObject({
      page: 1,
      limit: 100,
    });
  });

  test("tipe kontrak tidak dikenal dianggap tanpa filter", () => {
    expect(parseContractListParams(params({ type: "outsourcing" })).contractType).toBeNull();
  });
});
