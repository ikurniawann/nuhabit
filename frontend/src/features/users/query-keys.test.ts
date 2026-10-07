import { describe, it, expect } from "vitest";
import { usersQueryKeys } from "./query-keys";

describe("usersQueryKeys", () => {
  it("builds stable list keys from params", () => {
    const key = usersQueryKeys.list({ page: 1, search: "budi" });
    expect(key).toEqual(["users", "list", { page: 1, search: "budi" }]);
  });

  it("uses empty object when params omitted", () => {
    expect(usersQueryKeys.list()).toEqual(["users", "list", {}]);
  });

  it("builds detail key with id", () => {
    expect(usersQueryKeys.detail("emp-1")).toEqual(["users", "detail", "emp-1"]);
  });
});
