import { describe, expect, it } from "vitest";
import { passwordError } from "./password-rules";

describe("passwordError", () => {
  it("accepts 8 to 72 characters with a letter and a digit", () => {
    expect(passwordError("hyrox2026")).toBeNull();
    expect(passwordError(`a1${"x".repeat(70)}`)).toBeNull();
  });

  it("names the first broken rule", () => {
    expect(passwordError("short1")).toBe("Use at least 8 characters.");
    expect(passwordError(`a1${"x".repeat(71)}`)).toBe("Use at most 72 characters.");
    expect(passwordError("12345678")).toBe("Include at least one letter.");
    expect(passwordError("abcdefgh")).toBe("Include at least one digit.");
  });
});
