import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "./receiving-ui-http";

describe("apiErrorMessage", () => {
  it("prefers error string, then error.message, then message", () => {
    expect(apiErrorMessage({ success: false, error: "Tidak boleh" }, "x")).toBe("Tidak boleh");
    expect(apiErrorMessage({ error: { message: "Nested" }, message: "m" }, "x")).toBe("Nested");
    expect(apiErrorMessage({ message: "Lama" }, "x")).toBe("Lama");
  });
  it("falls back for empty or non-object bodies", () => {
    expect(apiErrorMessage(null, "fallback")).toBe("fallback");
    expect(apiErrorMessage({ error: "" }, "fallback")).toBe("fallback");
  });
});
