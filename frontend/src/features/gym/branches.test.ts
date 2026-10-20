import { describe, expect, it } from "vitest";
import { defaultBranchId } from "./branches";

const a = { id: "a", name: "Kemang" };
const b = { id: "b", name: "Senopati" };

describe("defaultBranchId", () => {
  it("uses the staff branch", () => {
    expect(defaultBranchId({ branches: [a, b], current_branch_id: "b" })).toBe("b");
  });

  it("falls back to the only branch", () => {
    expect(defaultBranchId({ branches: [a], current_branch_id: null })).toBe("a");
  });

  it("asks when staff work across branches", () => {
    expect(defaultBranchId({ branches: [a, b], current_branch_id: null })).toBe("");
    expect(defaultBranchId(undefined)).toBe("");
  });

  it("ignores a staff branch that is no longer active", () => {
    expect(defaultBranchId({ branches: [a, b], current_branch_id: "gone" })).toBe("");
  });
});
